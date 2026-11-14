using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace TPV.KHostBridge;

public sealed class BridgeServer(IBridgeProvider provider, TimeProvider? clock = null) : IAsyncDisposable
{
    private readonly byte[] token = RandomNumberGenerator.GetBytes(32);
    private readonly SemaphoreSlim searchLock = new(1, 1);
    private readonly SemaphoreSlim handoffLock = new(1, 1);
    private readonly object gate = new();
    private readonly Dictionary<string, CachedResult> results = [];
    private readonly Dictionary<string, Handoff> handoffs = [];
    private WebApplication? application;
    private int port;
    private DateTimeOffset Now => (clock ?? TimeProvider.System).GetUtcNow();
    public BridgeProfile Profile => new($"http://127.0.0.1:{port}", Convert.ToHexStringLower(token));
    private sealed record CachedResult(ProviderSong Song, DateTimeOffset Expires);
    private sealed class Handoff(string resultId, DateTimeOffset expires)
    {
        public string ResultId { get; } = resultId;
        public string State { get; set; } = "pending";
        public DateTimeOffset Expires { get; } = expires;
    }

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        if (application is not null) throw new InvalidOperationException("Bridge already started.");
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = [],
            ApplicationName = typeof(BridgeServer).Assembly.GetName().Name });
        builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Listen(IPAddress.Loopback, 0);
            options.Limits.MaxRequestBodySize = 4096;
            options.Limits.MaxConcurrentConnections = 8;
            options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(5);
            options.Limits.KeepAliveTimeout = TimeSpan.FromSeconds(15);
        });
        var app = builder.Build();
        app.Use(async (context, next) =>
        {
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.XContentTypeOptions = "nosniff";
            context.Response.Headers["X-TPV-KHost-Bridge"] = "1";
            if (context.Connection.RemoteIpAddress is not { } address || !IPAddress.IsLoopback(address)
                || context.Request.Host.Host != "127.0.0.1" || context.Request.Host.Port != port
                || context.Request.Headers.ContainsKey("Origin"))
            { await Error(context, 403, "forbidden"); return; }
            var authorization = context.Request.Headers.Authorization;
            if (authorization.Count != 1 || !Authorized(authorization[0]))
            { await Error(context, 401, "unauthorized"); return; }
            if (context.Request.QueryString.HasValue)
            { await Error(context, 400, "invalid-request"); return; }
            try { await next(context); }
            catch (OperationCanceledException) { if (!context.Response.HasStarted) await Error(context, 408, "timeout"); }
            catch (BadHttpRequestException) { if (!context.Response.HasStarted) await Error(context, 413, "invalid-request"); }
            catch (ProviderSignInRequiredException) { if (!context.Response.HasStarted) await Error(context, 409, "sign-in-required"); }
            catch { if (!context.Response.HasStarted) await Error(context, 503, "provider-unavailable"); }
        });
        app.MapGet("/v1/status", async context =>
        {
            await context.Response.WriteAsJsonAsync(new { application = "tpv-khost-bridge", apiVersion = 1,
                companion = "KHost", provider = "karafun", providerAvailable = provider.Available,
                externalPlayback = true, embeddedPlayback = false, acquisition = false });
        });
        app.MapPost("/v1/search", Search);
        app.MapPost("/v1/handoff", BeginHandoff);
        app.MapGet("/v1/handoffs/{requestId}", HandoffStatus);
        application = app;
        await app.StartAsync(cancellationToken);
        var urls = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()?.Addresses;
        var url = urls?.SingleOrDefault() ?? throw new InvalidOperationException("No loopback endpoint.");
        var endpoint = new Uri(url);
        if (endpoint.Host != "127.0.0.1" || endpoint.Scheme != "http") throw new InvalidOperationException("Unsafe endpoint.");
        port = endpoint.Port;
    }

    private bool Authorized(string? value)
    {
        if (value is null || !value.StartsWith("Bearer ", StringComparison.Ordinal) || value.Length != 71) return false;
        try { return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(value[7..]), token); }
        catch (FormatException) { return false; }
    }

    private async Task Search(HttpContext context)
    {
        using var body = await Body(context, ["query"]);
        if (body is null) return;
        if (body.RootElement.GetProperty("query").ValueKind != JsonValueKind.String)
        { await Error(context, 400, "invalid-request"); return; }
        var query = body.RootElement.GetProperty("query").GetString()?.Trim();
        if (query is null || query.Length < 2 || query.Length > 200 || query.Any(char.IsControl))
        { await Error(context, 400, "invalid-request"); return; }
        if (!provider.Available) { await Error(context, 409, "provider-unavailable"); return; }
        if (!await searchLock.WaitAsync(0)) { await Error(context, 429, "busy"); return; }
        try
        {
            // The provider contract has no cancellation parameter. Retain the
            // concurrency slot until it actually returns, even if the caller leaves.
            var songs = await provider.SearchAsync(query);
            var projected = new List<BridgeSong>();
            lock (gate)
            {
                var now = Now;
                foreach (var key in results.Where(pair => pair.Value.Expires < now).Select(pair => pair.Key).ToArray()) results.Remove(key);
                if (results.Count > 200) results.Clear();
                foreach (var song in songs.Take(20))
                {
                    if (!Regex.IsMatch(song.ProviderSongId ?? "", @"^(?:community:)?[0-9]{1,18}$")) continue;
                    var title = Clean(song.Title, 400); var artist = Clean(song.Artist, 400);
                    if (title.Length == 0) continue;
                    var id = Guid.NewGuid().ToString("D");
                    var safe = song with { ProviderSongId = song.ProviderSongId!, Title = title, Artist = artist };
                    results[id] = new(safe, now.AddMinutes(3));
                    projected.Add(new(id, safe.ProviderSongId, title, artist,
                        safe.DurationSeconds is > 0 and <= 86400 ? safe.DurationSeconds : null, safe.Enqueue is not null));
                }
            }
            await context.Response.WriteAsJsonAsync(new { status = "ready", songs = projected,
                externalPlayback = true, embeddedPlayback = false });
        }
        finally { searchLock.Release(); }
    }

    private async Task BeginHandoff(HttpContext context)
    {
        using var body = await Body(context, ["resultId", "requestId"]);
        if (body is null) return;
        if (!GetId(body.RootElement, "resultId", out var resultId) || !GetId(body.RootElement, "requestId", out var requestId))
        { await Error(context, 400, "invalid-request"); return; }
        Func<Task>? action = null;
        string state = "pending"; string? failure = null;
        lock (gate)
        {
            if (handoffs.TryGetValue(requestId, out var prior))
            {
                if (prior.ResultId != resultId) failure = "idempotency-conflict";
                else state = prior.State;
            }
            else if (!results.TryGetValue(resultId, out var row) || row.Expires < Now) failure = "expired-result";
            else if (row.Song.Enqueue is null) failure = "handoff-unavailable";
            else
            {
                foreach (var key in handoffs.Where(pair => pair.Value.Expires < Now && pair.Value.State != "pending")
                    .Select(pair => pair.Key).ToArray()) handoffs.Remove(key);
                if (handoffs.Count >= 100 || !handoffLock.Wait(0)) failure = "busy";
                else { handoffs[requestId] = new(resultId, Now.AddMinutes(30)); action = row.Song.Enqueue; }
            }
        }
        if (failure is not null) { await Error(context, failure == "busy" ? 429 : 409, failure); return; }
        if (action is not null)
        {
            // Only this explicit endpoint mutates the other application's queue.
            // Never retry a side effect after timeout; callers poll its requestId.
            _ = Task.Run(async () =>
            {
                var settled = "complete";
                try { await action(); } catch { settled = "failed"; }
                finally
                {
                    lock (gate) handoffs[requestId].State = settled;
                    handoffLock.Release();
                }
            });
        }
        context.Response.StatusCode = 202;
        await context.Response.WriteAsJsonAsync(new { status = "handed-off", requestId, state,
            playback = "external-khost", queueMayHaveChanged = true });
    }

    private async Task HandoffStatus(HttpContext context)
    {
        if (!Guid.TryParseExact(context.Request.RouteValues["requestId"]?.ToString(), "D", out var id))
        { await Error(context, 400, "invalid-request"); return; }
        Handoff? job;
        lock (gate) handoffs.TryGetValue(id.ToString("D"), out job);
        if (job is null) { await Error(context, 404, "unknown-request"); return; }
        string state; lock (gate) state = job.State;
        await context.Response.WriteAsJsonAsync(new { status = "handed-off", requestId = id.ToString("D"), state,
            playback = "external-khost", queueMayHaveChanged = true });
    }

    private static string Clean(string? value, int limit)
    {
        var clean = Regex.Replace(value ?? "", @"\s+", " ").Trim();
        return string.Concat(clean.Where(character => !char.IsControl(character))).Truncate(limit);
    }
    private static bool GetId(JsonElement value, string name, out string id)
    {
        id = "";
        if (value.GetProperty(name).ValueKind != JsonValueKind.String || !Guid.TryParseExact(value.GetProperty(name).GetString(), "D", out var guid)) return false;
        id = guid.ToString("D"); return true;
    }
    private static async Task<JsonDocument?> Body(HttpContext context, string[] expected)
    {
        if (context.Request.ContentType?.Split(';')[0].Trim() != "application/json" || context.Request.Headers.ContainsKey("Content-Encoding"))
        { await Error(context, 415, "invalid-request"); return null; }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        using var memory = new MemoryStream();
        var bytes = new byte[4097]; int count = 0;
        while (count < bytes.Length)
        {
            var read = await context.Request.Body.ReadAsync(bytes.AsMemory(count), timeout.Token);
            if (read == 0) break; count += read;
        }
        if (count > 4096) { await Error(context, 413, "invalid-request"); return null; }
        JsonDocument parsed;
        try { parsed = JsonDocument.Parse(bytes.AsMemory(0, count), new JsonDocumentOptions { MaxDepth = 4 }); }
        catch (JsonException) { await Error(context, 400, "invalid-request"); return null; }
        if (parsed.RootElement.ValueKind != JsonValueKind.Object
            || !parsed.RootElement.EnumerateObject().Select(property => property.Name).Order().SequenceEqual(expected.Order()))
        { parsed.Dispose(); await Error(context, 400, "invalid-request"); return null; }
        return parsed;
    }
    private static Task Error(HttpContext context, int code, string error)
    {
        context.Response.StatusCode = code;
        return context.Response.WriteAsJsonAsync(new { status = error });
    }
    public async ValueTask DisposeAsync()
    {
        var app = Interlocked.Exchange(ref application, null);
        if (app is not null) { await app.StopAsync(); await app.DisposeAsync(); }
    }
}

internal static class BridgeText
{
    public static string Truncate(this string value, int limit) => value.Length <= limit ? value : value[..limit];
}

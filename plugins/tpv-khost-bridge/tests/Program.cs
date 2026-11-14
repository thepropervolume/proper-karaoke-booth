using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using TPV.KHostBridge;

var provider = new FakeProvider();
var clock = new TestClock();
await using var server = new BridgeServer(provider, clock);
await server.StartAsync();
if (args.Length == 2 && args[0] == "--serve-test")
{
    var target = Path.GetFullPath(args[1]);
    if (Path.GetDirectoryName(target)?.TrimEnd(Path.DirectorySeparatorChar) != Path.GetFullPath(Path.GetTempPath()).TrimEnd(Path.DirectorySeparatorChar)
        || !Path.GetFileName(target).StartsWith("tpv-khost-interop-")) throw new Exception("Unsafe interop fixture path");
    provider.Complete.TrySetResult();
    await PrivateProfile.WriteAtAsync(server.Profile, target, CancellationToken.None);
    Console.WriteLine("READY");
    await Task.Delay(Timeout.InfiniteTimeSpan);
    return;
}
using var http = new HttpClient { BaseAddress = new Uri(server.Profile.BaseUrl), Timeout = TimeSpan.FromSeconds(5) };
var checks = 0;
void Check(bool ok, string name) { if (!ok) throw new Exception(name); ++checks; }
async Task<HttpResponseMessage> Call(string method, string route, object? body = null, string? origin = null, string? host = null, bool authenticate = true)
{
    var request = new HttpRequestMessage(new HttpMethod(method), route);
    if (authenticate) request.Headers.Authorization = new("Bearer", server.Profile.Token);
    if (body is not null) request.Content = JsonContent.Create(body);
    if (origin is not null) request.Headers.Add("Origin", origin);
    if (host is not null) request.Headers.Host = host;
    return await http.SendAsync(request);
}
using (var response = await Call("GET", "/v1/status", authenticate: false)) Check(response.StatusCode == HttpStatusCode.Unauthorized, "Unauthenticated request refused");
using (var response = await Call("GET", "/v1/status", origin: "http://evil.example")) Check(response.StatusCode == HttpStatusCode.Forbidden, "Browser origin refused");
using (var response = await Call("GET", "/v1/status", host: "evil.example")) Check(response.StatusCode == HttpStatusCode.Forbidden, "Host rebinding refused");
using (var response = await Call("GET", "/v1/status?url=http://evil.example")) Check(response.StatusCode == HttpStatusCode.BadRequest, "Query arguments refused");
using (var response = await Call("GET", "/v1/status"))
{
    var value = await response.Content.ReadFromJsonAsync<JsonElement>();
    Check(value.GetProperty("application").GetString() == "tpv-khost-bridge", "Bridge identity");
    Check(!value.GetProperty("embeddedPlayback").GetBoolean() && !value.GetProperty("acquisition").GetBoolean(), "Native playback and acquisition not claimed");
}
using (var response = await Call("POST", "/v1/search", new { query = "x" })) Check(response.StatusCode == HttpStatusCode.BadRequest, "Invalid query refused");
using (var response = await Call("POST", "/v1/search", new { query = "song", url = "private" })) Check(response.StatusCode == HttpStatusCode.BadRequest, "Unknown fields refused");
using (var response = await Call("POST", "/v1/search", new { query = new string('a', 5000) })) Check(response.StatusCode == HttpStatusCode.RequestEntityTooLarge, "Bounded request body");
string resultId;
using (var response = await Call("POST", "/v1/search", new { query = "Artist Song" }))
{
    var value = await response.Content.ReadFromJsonAsync<JsonElement>(); var songs = value.GetProperty("songs");
    Check(songs.GetArrayLength() == 1, "Actual provider rows projected");
    resultId = songs[0].GetProperty("resultId").GetString()!;
    Check(Guid.TryParse(resultId, out _), "Opaque result capability");
    Check(provider.Searches == 1 && provider.Enqueues == 0, "Searching never queues");
}
var requestId = Guid.NewGuid().ToString("D");
using (var response = await Call("POST", "/v1/handoff", new { resultId, requestId })) Check(response.StatusCode == HttpStatusCode.Accepted, "Explicit handoff accepted");
using (var response = await Call("POST", "/v1/handoff", new { resultId, requestId })) Check(response.StatusCode == HttpStatusCode.Accepted, "Same request may be observed safely");
for (var i = 0; i < 30 && provider.Enqueues == 0; i++) await Task.Delay(10);
Check(provider.Enqueues == 1, "Idempotent enqueue side effect");
using (var response = await Call("POST", "/v1/handoff", new { resultId = Guid.NewGuid().ToString("D"), requestId })) Check(response.StatusCode == HttpStatusCode.Conflict, "Request id cannot target a different song");
using (var response = await Call("POST", "/v1/handoff", new { resultId, requestId = Guid.NewGuid().ToString("D") })) Check(response.StatusCode == HttpStatusCode.TooManyRequests, "At most one pending handoff");
provider.Complete.TrySetResult();
string? state = null;
for (var i = 0; i < 30 && state != "complete"; i++)
{
    using var response = await Call("GET", "/v1/handoffs/" + requestId);
    var value = await response.Content.ReadFromJsonAsync<JsonElement>(); state = value.GetProperty("state").GetString();
    if (state != "complete") await Task.Delay(10);
}
Check(state == "complete" && provider.Enqueues == 1, "Poll completion without replaying action");
clock.Advance(TimeSpan.FromMinutes(4));
using (var response = await Call("POST", "/v1/handoff", new { resultId, requestId = Guid.NewGuid().ToString("D") })) Check(response.StatusCode == HttpStatusCode.Conflict, "Expired search result refused");
using (var response = await Call("GET", "/v1/handoffs/" + Guid.NewGuid().ToString("D"))) Check(response.StatusCode == HttpStatusCode.NotFound, "Unknown handoff not invented");
provider.Available = false;
using (var response = await Call("POST", "/v1/search", new { query = "song" })) Check(response.StatusCode == HttpStatusCode.Conflict, "Unavailable provider refused");
var temporaryRoot = Path.GetFullPath(Path.GetTempPath());
var temporary = Path.Combine(temporaryRoot, "tpv-khost-profile-test-" + Guid.NewGuid().ToString("N"));
try
{
    var path = await PrivateProfile.WriteAtAsync(server.Profile, temporary, CancellationToken.None);
    var json = JsonDocument.Parse(await File.ReadAllTextAsync(path));
    Check(json.RootElement.GetProperty("baseUrl").GetString() == server.Profile.BaseUrl, "Protected profile round trip");
    Check(json.RootElement.EnumerateObject().Count() == 2, "No KaraFun credentials in profile");
    if (!OperatingSystem.IsWindows()) Check((File.GetUnixFileMode(path) & (UnixFileMode.GroupRead | UnixFileMode.OtherRead)) == 0, "POSIX owner-only profile");
}
finally
{
    var target = Path.GetFullPath(temporary);
    if (Path.GetDirectoryName(target)?.TrimEnd(Path.DirectorySeparatorChar) != temporaryRoot.TrimEnd(Path.DirectorySeparatorChar)
        || !Path.GetFileName(target).StartsWith("tpv-khost-profile-test-")) throw new Exception("Unsafe cleanup");
    if (Directory.Exists(target)) Directory.Delete(target, true);
}
Console.WriteLine($"PASS: {checks} bridge HTTP/profile checks with synthetic provider; no real KHost account or media used.");

sealed class FakeProvider : IBridgeProvider
{
    public bool Available { get; set; } = true;
    public int Searches; public int Enqueues;
    public TaskCompletionSource Complete { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public Task<IReadOnlyList<ProviderSong>> SearchAsync(string query)
    {
        Interlocked.Increment(ref Searches);
        return Task.FromResult<IReadOnlyList<ProviderSong>>([new("12345", "Song", "Artist", 180, async () =>
        { Interlocked.Increment(ref Enqueues); await Complete.Task; })]);
    }
}
sealed class TestClock : TimeProvider
{
    private DateTimeOffset now = DateTimeOffset.UtcNow;
    public override DateTimeOffset GetUtcNow() => now;
    public void Advance(TimeSpan delta) => now += delta;
}

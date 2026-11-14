namespace TPV.KHostBridge;

public sealed record ProviderSong(string ProviderSongId, string Title, string Artist,
    double? DurationSeconds, Func<Task>? Enqueue);

public interface IBridgeProvider
{
    bool Available { get; }
    Task<IReadOnlyList<ProviderSong>> SearchAsync(string query);
}

public sealed record BridgeSong(string ResultId, string ProviderSongId, string Title,
    string Artist, double? DurationSeconds, bool CanHandoff);

public sealed record BridgeProfile(string BaseUrl, string Token);

public sealed class ProviderSignInRequiredException : Exception { }

using KHost.Abstractions.Services;

namespace TPV.KHostBridge;

// This adapter uses only the separately MIT-licensed public plugin contracts.
// It never accesses the KaraFun plugin's classes, credentials or private API.
public sealed class KHostProvider(IMediaSearchService search) : IBridgeProvider
{
    public bool Available => search.Providers.Any(provider => provider.SourceName == "KaraFun");

    public async Task<IReadOnlyList<ProviderSong>> SearchAsync(string query)
    {
        var rows = await search.SearchAsync(query, "KaraFun", 1, 20);
        if (rows.Any(row => row.Source == "KaraFun" && row.SpansAllColumns
            && row.SupportedActions.Any(action => action.DisplayName == "Sign in"))) throw new ProviderSignInRequiredException();
        return rows.Where(row => row.Source == "KaraFun" && !row.SpansAllColumns)
            .Select(row =>
            {
                // Invoke only an action actually offered on this exact result.
                // Enqueue is the installed provider's normal host-facing action.
                var action = row.SupportedActions.FirstOrDefault(action => action.DisplayName == "Enqueue");
                return new ProviderSong(row.ForeignKey, row.Title, row.Artist,
                    row.Duration?.TotalSeconds, action is null ? null : () => action.PerformAsync(row));
            }).ToArray();
    }
}

using KHost.Abstractions.Services;
using Microsoft.Extensions.Hosting;

namespace TPV.KHostBridge;

public sealed class BridgePlugin(IMediaSearchService search, IHostApplicationLifetime lifetime) : IPlugin
{
    private BridgeServer? server;
    private IDisposable? shutdown;

    public async Task InitializeAsync(IPluginContext context, CancellationToken cancellationToken = default)
    {
        var connection = new BridgeServer(new KHostProvider(search));
        try
        {
            await connection.StartAsync(cancellationToken);
            var profile = await PrivateProfile.WriteAsync(connection.Profile, cancellationToken);
            shutdown = lifetime.ApplicationStopping.Register(() => { _ = connection.DisposeAsync(); });
            server = connection;
            context.AddWarning("Companion bridge enabled. Choose this private connection file in The Proper Volume Sources: " + profile
                + ". Playback and singer selection remain in KHost.");
        }
        catch
        {
            await connection.DisposeAsync();
            throw new InvalidOperationException("The companion bridge could not start or publish an owner-only connection file.");
        }
    }
}

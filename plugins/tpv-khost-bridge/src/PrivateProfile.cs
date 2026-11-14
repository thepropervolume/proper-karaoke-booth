using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;

namespace TPV.KHostBridge;

public static class PrivateProfile
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static async Task<string> WriteAsync(BridgeProfile profile, CancellationToken cancellationToken)
    {
        var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "TheProperVolume", "KHostBridge");
        return await WriteAtAsync(profile, directory, cancellationToken);
    }

    internal static async Task<string> WriteAtAsync(BridgeProfile profile, string directory, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(directory);
        RejectLink(directory);
        if (OperatingSystem.IsWindows())
        {
            var identity = WindowsIdentity.GetCurrent().User ?? throw new IOException();
            var acl = new DirectorySecurity();
            acl.SetOwner(identity); acl.SetAccessRuleProtection(true, false);
            foreach (var id in new[] { identity, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null) })
                acl.AddAccessRule(new FileSystemAccessRule(id, FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                    PropagationFlags.None, AccessControlType.Allow));
            new DirectoryInfo(directory).SetAccessControl(acl);
        }
        else File.SetUnixFileMode(directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var path = Path.Combine(directory, "connection.json");
        if (File.Exists(path)) RejectLink(path);
        var temporary = Path.Combine(directory, ".connection-" + Guid.NewGuid().ToString("N"));
        try
        {
            var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.Write, Share = FileShare.None };
            if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
            await using (var file = new FileStream(temporary, options))
            {
                await JsonSerializer.SerializeAsync(file, profile, Json, cancellationToken);
                await file.FlushAsync(cancellationToken);
                file.Flush(true);
            }
            if (OperatingSystem.IsWindows())
            {
                var identity = WindowsIdentity.GetCurrent().User ?? throw new IOException();
                var acl = new FileSecurity(); acl.SetOwner(identity); acl.SetAccessRuleProtection(true, false);
                foreach (var id in new[] { identity, new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null) })
                    acl.AddAccessRule(new FileSystemAccessRule(id, FileSystemRights.FullControl, AccessControlType.Allow));
                new FileInfo(temporary).SetAccessControl(acl);
            }
            RejectLink(directory);
            if (File.Exists(path)) RejectLink(path);
            File.Move(temporary, path, overwrite: true);
            return path;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private static void RejectLink(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new IOException("Private bridge paths cannot be links.");
    }
}

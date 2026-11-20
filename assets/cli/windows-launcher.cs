using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

internal static class BoothCli
{
    private const string RegistrationKey = @"Software\The Proper Volume\Karaoke Booth";
    private const string RegistrationValue = "InstalledCliPath";
    private const string CreatedPathValue = "InstalledCliCreatedPath";
    private const string RunAsNode = "ELECTRON_RUN_AS_NODE";

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wParam,
        string lParam, uint flags, uint timeout, out IntPtr result);

    private static int Main(string[] args)
    {
        try
        {
            string directory = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            if (args.Length == 1 && (args[0] == "--register-windows-path" || args[0] == "--register-windows-path-machine"))
            {
                UpdatePath(directory, true, args[0].EndsWith("-machine", StringComparison.Ordinal));
                return 0;
            }
            if (args.Length == 1 && (args[0] == "--unregister-windows-path" || args[0] == "--unregister-windows-path-machine"))
            {
                UpdatePath(directory, false, args[0].EndsWith("-machine", StringComparison.Ordinal));
                return 0;
            }

            bool desktop = args.Length > 0 && (args[0] == "--settings" || args[0] == "--keybindings");
            var command = new StringBuilder();
            if (!desktop) command.Append(Quote(Path.Combine(directory, @"resources\control\cli.cjs")));
            foreach (var argument in args)
            {
                if (command.Length > 0) command.Append(' ');
                command.Append(Quote(argument));
            }
            var launch = new ProcessStartInfo(Path.Combine(directory, "proper-karaoke-booth.exe"), command.ToString());
            launch.UseShellExecute = false;
            if (desktop) launch.EnvironmentVariables.Remove(RunAsNode);
            else launch.EnvironmentVariables[RunAsNode] = "1";
            using (var child = Process.Start(launch))
            {
                if (desktop) return 0;
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception failure)
        {
            Console.Error.WriteLine("Karaoke Booth CLI: " + failure.Message);
            return 5;
        }
    }

    // ProcessStartInfo.Arguments takes one string on .NET Framework. Doubling
    // slashes before quotes preserves the exact argv, including JSON and UNC paths.
    private static string Quote(string value)
    {
        var quoted = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                slashes++;
                continue;
            }
            quoted.Append('\\', character == '"' ? 2 * slashes + 1 : slashes);
            slashes = 0;
            quoted.Append(character);
        }
        return quoted.Append('\\', 2 * slashes).Append('"').ToString();
    }

    private static string NormalizedEntry(string path)
    {
        return Environment.ExpandEnvironmentVariables(path.Trim().Trim('"')).TrimEnd('\\');
    }

    private static void UpdatePath(string directory, bool install, bool machine)
    {
        if (directory.IndexOfAny(new[] { ';', '%', '"', '\r', '\n' }) >= 0)
            throw new ArgumentException("This installation directory cannot be added to PATH.");

        var root = machine ? Registry.LocalMachine : Registry.CurrentUser;
        string environmentKey = machine ? @"SYSTEM\CurrentControlSet\Control\Session Manager\Environment" : "Environment";
        using (RegistryKey environment = root.CreateSubKey(environmentKey))
        using (RegistryKey registration = root.CreateSubKey(RegistrationKey))
        {
            if (!ApplyPathRegistration(environment, registration, directory, install)) return;
        }
        IntPtr ignored;
        SendMessageTimeout(new IntPtr(0xffff), 0x001a, IntPtr.Zero, "Environment", 2, 1000, out ignored);
    }

    private static bool ApplyPathRegistration(RegistryKey environment, RegistryKey registration,
        string directory, bool install)
    {
        var previous = environment.GetValue("Path", null, RegistryValueOptions.DoNotExpandEnvironmentNames);
        string path = previous as string ?? "";
        var kind = previous == null ? RegistryValueKind.ExpandString : environment.GetValueKind("Path");
        if (kind != RegistryValueKind.String && kind != RegistryValueKind.ExpandString)
            throw new InvalidOperationException("Unsupported PATH format.");
        string[] entries = path.Split(';');
        var comparison = StringComparison.OrdinalIgnoreCase;
        string owned = registration.GetValue(RegistrationValue, "") as string;
        if (install)
        {
            if (Array.Exists(entries, entry => string.Equals(NormalizedEntry(entry), directory, comparison))) return false;
            string updated = path.Length == 0 ? directory : path + ";" + directory;
            if (updated.Length > 32000) throw new InvalidOperationException("PATH is too long.");
            environment.SetValue("Path", updated, kind);
            try
            {
                registration.SetValue(CreatedPathValue, previous == null ? 1 : 0, RegistryValueKind.DWord);
                registration.SetValue(RegistrationValue, directory, RegistryValueKind.String);
            }
            catch
            {
                if (previous == null) environment.DeleteValue("Path", false);
                else environment.SetValue("Path", previous, kind);
                throw;
            }
        }
        else
        {
            if (!string.Equals(owned, directory, comparison)) return false;
            // Remove only the exact entry we inserted, retaining independent
            // equivalent entries and the raw spelling of unrelated values.
            int index = Array.FindLastIndex(entries, entry => string.Equals(entry, owned, StringComparison.Ordinal));
            if (index >= 0)
            {
                var remaining = new System.Collections.Generic.List<string>(entries);
                remaining.RemoveAt(index);
                if (remaining.Count == 0 && object.Equals(registration.GetValue(CreatedPathValue), 1)) environment.DeleteValue("Path", false);
                else environment.SetValue("Path", string.Join(";", remaining), kind);
            }
            registration.DeleteValue(RegistrationValue, false);
            registration.DeleteValue(CreatedPathValue, false);
        }
        return true;
    }
}

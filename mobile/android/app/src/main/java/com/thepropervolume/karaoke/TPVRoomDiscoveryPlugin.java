package com.thepropervolume.karaoke;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.HashSet;

/** DNS-SD suggests a public HTTPS room. It never authorizes a singer or probes LAN hosts. */
@CapacitorPlugin(name = "TPVRoomDiscovery")
public class TPVRoomDiscoveryPlugin extends Plugin {
    private static final String TYPE = "_tpv-karaoke._tcp.";
    private final Handler handler = new Handler(Looper.getMainLooper());
    private NsdManager manager;
    private NsdManager.DiscoveryListener browser;
    private NsdManager.RegistrationListener advertisement;
    private PluginCall pending;
    private JSArray rooms;
    private final HashSet<String> seen = new HashSet<>();
    private final ArrayDeque<NsdServiceInfo> resolving = new ArrayDeque<>();
    private boolean busy;
    private long scanGeneration;
    private Runnable scanTimeout;
    @Override public void load() { manager = (NsdManager) getContext().getSystemService(Context.NSD_SERVICE); }
    private boolean valid(String url) { return url != null && url.matches("https://queue\\.thepropervolume\\.com/[a-z0-9][a-z0-9-]{1,46}[a-z0-9]"); }
    @PluginMethod public void discover(PluginCall call) {
        handler.post(() -> {
            if (pending != null) { call.reject("Discovery is already running."); return; }
            final long generation = ++scanGeneration;
            pending = call; rooms = new JSArray(); seen.clear(); resolving.clear(); busy = false;
            browser = new NsdManager.DiscoveryListener() {
                public void onDiscoveryStarted(String t) {}
                public void onDiscoveryStopped(String t) {}
                public void onStartDiscoveryFailed(String t, int e) { handler.post(() -> finish(generation)); }
                public void onStopDiscoveryFailed(String t, int e) {}
                public void onServiceLost(NsdServiceInfo s) {}
                public void onServiceFound(NsdServiceInfo s) { handler.post(() -> { if (generation == scanGeneration && pending != null && seen.size() < 20 && seen.add(s.getServiceName())) { resolving.add(s); resolveNext(generation); } }); }
            };
            try {
                manager.discoverServices(TYPE, NsdManager.PROTOCOL_DNS_SD, browser);
                scanTimeout = () -> finish(generation); handler.postDelayed(scanTimeout, 8000);
            }
            catch (SecurityException e) { finish(generation, "Allow local network access to find nearby rooms."); }
            catch (RuntimeException e) { finish(generation); }
        });
    }
    @SuppressWarnings("deprecation") private void resolveNext(final long generation) {
        if (generation != scanGeneration || busy || pending == null || resolving.isEmpty()) return;
        busy = true;
        try { manager.resolveService(resolving.remove(), new NsdManager.ResolveListener() {
            public void onResolveFailed(NsdServiceInfo s, int code) { handler.post(() -> { if (generation == scanGeneration) { busy = false; resolveNext(generation); } }); }
            public void onServiceResolved(NsdServiceInfo s) { handler.post(() -> {
                if (generation != scanGeneration) return;
                if (pending != null && rooms.length() < 20) {
                    byte[] bytes = s.getAttributes().get("url");
                    String url = bytes != null && bytes.length <= 200 ? new String(bytes, StandardCharsets.UTF_8) : "";
                    if (valid(url)) { JSObject room = new JSObject(); room.put("url", url); room.put("name", s.getServiceName().substring(0, Math.min(100, s.getServiceName().length()))); rooms.put(room); }
                }
                busy = false; resolveNext(generation);
            }); }
        }); } catch (RuntimeException e) { if (generation == scanGeneration) { busy = false; resolveNext(generation); } }
    }
    private void finish(long generation) { finish(generation, null); }
    private void finish(long generation, String error) {
        if (generation != scanGeneration) return;
        ++scanGeneration;
        if (scanTimeout != null) { handler.removeCallbacks(scanTimeout); scanTimeout = null; }
        if (browser != null) { try { manager.stopServiceDiscovery(browser); } catch (RuntimeException ignored) {} browser = null; }
        if (pending != null) {
            if (error != null) pending.reject(error);
            else { JSObject value = new JSObject(); value.put("rooms", rooms); pending.resolve(value); }
            pending = null;
        }
        resolving.clear(); busy = false;
    }
    /** DNS labels are limited by UTF-8 bytes; never split a Unicode code point. */
    private static String serviceLabel(String input) {
        String clean = (input == null ? "" : input).replaceAll("[.\\p{Cntrl}]", "-").trim();
        StringBuilder result = new StringBuilder(); int bytes = 0;
        for (int offset = 0; offset < clean.length();) {
            int point = clean.codePointAt(offset); String character = new String(Character.toChars(point));
            int length = character.getBytes(StandardCharsets.UTF_8).length;
            if (bytes + length > 63) break;
            result.append(character); bytes += length; offset += Character.charCount(point);
        }
        String label = result.toString().trim(); return label.isEmpty() ? "TPV Karaoke" : label;
    }
    @PluginMethod public void advertise(PluginCall call) {
        String url = call.getString("url"), name = call.getString("name", "TPV Karaoke");
        if (!valid(url)) { call.reject("Invalid room address."); return; }
        handler.post(() -> {
            stopAdvertisement();
            NsdServiceInfo service = new NsdServiceInfo(); service.setServiceType(TYPE); service.setServiceName(serviceLabel(name)); service.setPort(443); service.setAttribute("url", url);
            advertisement = new NsdManager.RegistrationListener() {
                public void onServiceRegistered(NsdServiceInfo s) { call.resolve(); }
                public void onRegistrationFailed(NsdServiceInfo s, int code) { call.reject("Room advertisement unavailable."); }
                public void onServiceUnregistered(NsdServiceInfo s) {}
                public void onUnregistrationFailed(NsdServiceInfo s, int code) {}
            };
            try { manager.registerService(service, NsdManager.PROTOCOL_DNS_SD, advertisement); } catch (RuntimeException e) { advertisement = null; call.reject("Room advertisement unavailable."); }
        });
    }
    private void stopAdvertisement() { if (advertisement != null) { try { manager.unregisterService(advertisement); } catch (RuntimeException ignored) {} advertisement = null; } }
    @PluginMethod public void stop(PluginCall call) { handler.post(() -> { stopAdvertisement(); call.resolve(); }); }
    @Override protected void handleOnDestroy() { handler.post(() -> { finish(scanGeneration); stopAdvertisement(); handler.removeCallbacksAndMessages(null); }); }
}

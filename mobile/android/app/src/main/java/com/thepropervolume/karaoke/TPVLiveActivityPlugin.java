package com.thepropervolume.karaoke;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "TPVLiveActivity")
public class TPVLiveActivityPlugin extends Plugin {
    private static final String CHANNEL_ID = "tpv-now-playing";
    private static final int NOTIFICATION_ID = 8416;
    private static final long STALE_AFTER_MS = 75_000;

    @PluginMethod
    public void status(PluginCall call) {
        resolve(call, availability(notificationManager()));
    }

    @PluginMethod
    public void update(PluginCall call) {
        NotificationManager manager = notificationManager();
        String status = availability(manager);
        if (!"available".equals(status)) {
            resolve(call, status);
            return;
        }

        String title = text(call, "title", 110);
        if (title.isEmpty()) {
            call.reject("Now Playing needs a track title.");
            return;
        }

        String room = text(call, "room", 80);
        String artist = text(call, "artist", 85);
        String singer = text(call, "singer", 85);
        boolean paused = Boolean.TRUE.equals(call.getBoolean("paused", false));
        String state = paused ? "Paused" : "Now Playing";
        String details = singer.isEmpty() ? artist : "Sung by " + singer;

        // API 26+ can expire the notification even after the WebView is suspended.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            && manager.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Room Now Playing", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("The current song in a room you’re following");
            channel.setShowBadge(false);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            manager.createNotificationChannel(channel);
        }

        NotificationCompat.Builder notification = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_room_now_playing)
            .setContentTitle(title)
            .setContentText(details.isEmpty() ? state : state + " · " + details)
            .setSubText(room.isEmpty() ? "Karaoke Booth" : room)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setSilent(true)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setTimeoutAfter(STALE_AFTER_MS);
        Integer progress = call.getInt("progress");
        if (progress != null && progress >= 0 && progress <= 100) {
            notification.setProgress(100, progress, false);
        }

        Intent openApp = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
        if (openApp != null) {
            notification.setContentIntent(PendingIntent.getActivity(
                getContext(), NOTIFICATION_ID, openApp, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        }

        try {
            manager.notify(NOTIFICATION_ID, notification.build());
            resolve(call, "available");
        } catch (SecurityException ignored) {
            resolve(call, "blocked");
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        NotificationManager manager = notificationManager();
        if (manager != null) manager.cancel(NOTIFICATION_ID);
        call.resolve();
    }

    private NotificationManager notificationManager() {
        return (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private String availability(NotificationManager manager) {
        if (manager == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return "unsupported";
        if (!manager.areNotificationsEnabled()
            || Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) return "blocked";
        NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
        return channel != null && channel.getImportance() == NotificationManager.IMPORTANCE_NONE ? "blocked" : "available";
    }

    private static String text(PluginCall call, String key, int maxCodePoints) {
        String value = call.getString(key, "").replaceAll("[\\p{Cc}]", " ").trim();
        int length = value.codePointCount(0, value.length());
        return length <= maxCodePoints ? value : value.substring(0, value.offsetByCodePoints(0, maxCodePoints));
    }

    private static void resolve(PluginCall call, String status) {
        JSObject result = new JSObject();
        result.put("status", status);
        call.resolve(result);
    }
}

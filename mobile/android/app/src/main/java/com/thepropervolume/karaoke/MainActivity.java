package com.thepropervolume.karaoke;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(TPVRoomDiscoveryPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

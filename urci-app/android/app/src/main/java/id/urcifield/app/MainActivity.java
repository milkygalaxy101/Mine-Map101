package id.urcifield.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UrciStoragePlugin.class); // must be registered before super.onCreate
        super.onCreate(savedInstanceState);

        // Back button (owner request): close the open sheet/dialog first (JS decides, never a destructive button),
        // else go to the previous panel, else put the app in the background instead of closing it.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                final WebView wv = getBridge() != null ? getBridge().getWebView() : null;
                if (wv == null) { moveTaskToBack(true); return; }
                wv.evaluateJavascript("(window.__urciBack ? window.__urciBack() : false)", (handled) -> {
                    if ("true".equals(handled)) return;
                    if (wv.canGoBack()) wv.goBack();
                    else moveTaskToBack(true);
                });
            }
        });
    }
}

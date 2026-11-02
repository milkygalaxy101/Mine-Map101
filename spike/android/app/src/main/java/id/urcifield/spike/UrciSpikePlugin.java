package id.urcifield.spike;

// THROWAWAY week-1 spike plugin (eng review R13). Proves on a real phone:
//  - SAF folder pick with persisted permission (ACTION_OPEN_DOCUMENT_TREE)
//  - crash-safe replace on SAF: write name.new -> rename old to name.old -> rename .new -> delete .old
//  - serving data-folder files to the WebView at https://localhost/_saf/<path> (no base64 bridge)
//  - native GPS fix via LocationManager (fallback path for phones without Play Services)
//  - free-space probe
// Production code (UrciStorage) will be a cleaned-up Kotlin version of these ideas.

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.util.Base64;
import android.webkit.MimeTypeMap;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.activity.result.ActivityResult;
import androidx.documentfile.provider.DocumentFile;

import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "UrciSpike")
public class UrciSpikePlugin extends Plugin {

    private static final String PREFS = "urci_spike";
    private static final String KEY_TREE = "tree_uri";
    private static final String SAF_PREFIX = "/_saf/";

    @Override
    public void load() {
        // Serve /_saf/<path> from the picked folder; everything else goes to Capacitor's local server.
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String path = url.getPath();
                if (path != null && path.startsWith(SAF_PREFIX)) {
                    return serveSaf(path.substring(SAF_PREFIX.length()));
                }
                return super.shouldInterceptRequest(view, request);
            }
        });
    }

    private WebResourceResponse serveSaf(String relPath) {
        try {
            DocumentFile f = resolve(relPath, false);
            if (f == null || !f.isFile()) return notFound();
            InputStream in = getContext().getContentResolver().openInputStream(f.getUri());
            String ext = MimeTypeMap.getFileExtensionFromUrl(f.getName());
            String mime = ext != null ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase()) : null;
            Map<String, String> headers = new HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-store");
            return new WebResourceResponse(mime != null ? mime : "application/octet-stream", null, 200, "OK", headers, in);
        } catch (Exception e) {
            return notFound();
        }
    }

    private WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<>(), null);
    }

    // ---------- folder ----------

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "onFolderPicked");
    }

    @ActivityCallback
    private void onFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled", "CANCELLED");
            return;
        }
        Uri tree = result.getData().getData();
        getContext().getContentResolver().takePersistableUriPermission(tree,
                Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        prefs().edit().putString(KEY_TREE, tree.toString()).apply();
        JSObject ret = new JSObject();
        ret.put("uri", tree.toString());
        call.resolve(ret);
    }

    @PluginMethod
    public void folderStatus(PluginCall call) {
        JSObject ret = new JSObject();
        DocumentFile root = root();
        ret.put("hasFolder", root != null && root.canWrite());
        ret.put("uri", prefs().getString(KEY_TREE, null));
        call.resolve(ret);
    }

    // ---------- crash-safe write ----------

    @PluginMethod
    public void writeFileSafe(PluginCall call) {
        String path = call.getString("path");
        String base64 = call.getString("base64");
        String text = call.getString("text");
        if (path == null || (base64 == null && text == null)) {
            call.reject("path and base64|text required", "BAD_ARGS");
            return;
        }
        long t0 = System.nanoTime();
        try {
            byte[] bytes = base64 != null ? Base64.decode(base64, Base64.DEFAULT) : text.getBytes(StandardCharsets.UTF_8);
            long tDecode = System.nanoTime();
            int slash = path.lastIndexOf('/');
            String dirPath = slash >= 0 ? path.substring(0, slash) : "";
            String name = slash >= 0 ? path.substring(slash + 1) : path;
            DocumentFile dir = dirPath.isEmpty() ? root() : resolve(dirPath, true);
            if (dir == null) {
                call.reject("no folder", "PERMISSION_LOST");
                return;
            }
            // 1. write name.new
            DocumentFile stale = dir.findFile(name + ".new");
            if (stale != null) stale.delete();
            DocumentFile tmp = dir.createFile("application/octet-stream", name + ".new");
            if (tmp == null) {
                call.reject("create failed", "IO");
                return;
            }
            String createdName = tmp.getName();
            try (OutputStream out = getContext().getContentResolver().openOutputStream(tmp.getUri(), "wt")) {
                if (out == null) throw new Exception("no output stream");
                out.write(bytes);
            }
            // 2. existing -> name.old ; 3. .new -> name ; 4. delete .old
            DocumentFile existing = dir.findFile(name);
            boolean renamedOld = false;
            if (existing != null) {
                DocumentFile oldStale = dir.findFile(name + ".old");
                if (oldStale != null) oldStale.delete();
                renamedOld = existing.renameTo(name + ".old");
            }
            boolean renamedNew = tmp.renameTo(name);
            String finalName = tmp.getName();
            if (renamedOld) {
                DocumentFile old = dir.findFile(name + ".old");
                if (old != null) old.delete();
            }
            long t1 = System.nanoTime();
            JSObject ret = new JSObject();
            ret.put("bytes", bytes.length);
            ret.put("decodeMs", (tDecode - t0) / 1e6);
            ret.put("totalMs", (t1 - t0) / 1e6);
            ret.put("createdTempName", createdName); // reveals SAF auto-rename behaviour (e.g. "x.jpg.new" vs "x.jpg (1).new")
            ret.put("finalName", finalName);
            ret.put("renamedOld", renamedOld);
            ret.put("renamedNew", renamedNew);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    @PluginMethod
    public void list(PluginCall call) {
        String path = call.getString("path", "");
        long t0 = System.nanoTime();
        DocumentFile dir = path.isEmpty() ? root() : resolve(path, false);
        if (dir == null) {
            call.reject("no folder", "PERMISSION_LOST");
            return;
        }
        JSArray names = new JSArray();
        for (DocumentFile f : dir.listFiles()) names.put(f.getName());
        JSObject ret = new JSObject();
        ret.put("names", names);
        ret.put("ms", (System.nanoTime() - t0) / 1e6);
        call.resolve(ret);
    }

    // ---------- device probes ----------

    @PluginMethod
    public void freeSpace(PluginCall call) {
        StatFs fs = new StatFs(Environment.getExternalStorageDirectory().getPath());
        JSObject ret = new JSObject();
        ret.put("freeBytes", fs.getAvailableBytes());
        call.resolve(ret);
    }

    @PluginMethod
    public void nativeFix(PluginCall call) {
        final LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        final int timeoutMs = call.getInt("timeoutMs", 10000);
        final long t0 = System.currentTimeMillis();
        if (lm == null || !lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            call.reject("gps provider off", "GPS_OFF");
            return;
        }
        final Handler h = new Handler(Looper.getMainLooper());
        final boolean[] done = {false};
        final LocationListener[] holder = new LocationListener[1];
        holder[0] = new LocationListener() {
            @Override public void onLocationChanged(Location loc) {
                if (done[0]) return;
                done[0] = true;
                lm.removeUpdates(this);
                JSObject ret = new JSObject();
                ret.put("lat", loc.getLatitude());
                ret.put("lon", loc.getLongitude());
                ret.put("accuracy", loc.getAccuracy());
                ret.put("gpsTime", loc.getTime());
                ret.put("phoneTime", System.currentTimeMillis());
                ret.put("fixMs", System.currentTimeMillis() - t0);
                call.resolve(ret);
            }
            @Override public void onStatusChanged(String p, int s, Bundle b) {}
            @Override public void onProviderEnabled(String p) {}
            @Override public void onProviderDisabled(String p) {}
        };
        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 0L, 0f, holder[0], Looper.getMainLooper());
        } catch (SecurityException e) {
            call.reject("location permission missing", "PERMISSION");
            return;
        }
        h.postDelayed(() -> {
            if (done[0]) return;
            done[0] = true;
            lm.removeUpdates(holder[0]);
            call.reject("no fix in " + timeoutMs + " ms", "NO_FIX");
        }, timeoutMs);
    }

    // ---------- helpers ----------

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private DocumentFile root() {
        String s = prefs().getString(KEY_TREE, null);
        if (s == null) return null;
        return DocumentFile.fromTreeUri(getContext(), Uri.parse(s));
    }

    private DocumentFile resolve(String relPath, boolean createDirs) {
        DocumentFile cur = root();
        if (cur == null) return null;
        String[] parts = relPath.split("/");
        for (int i = 0; i < parts.length; i++) {
            String p = parts[i];
            if (p.isEmpty() || p.equals(".") || p.equals("..")) return null; // no traversal
            DocumentFile next = cur.findFile(p);
            boolean last = i == parts.length - 1;
            if (next == null) {
                if (!createDirs) return null;
                next = cur.createDirectory(p);
                if (next == null) return null;
            }
            if (!last && !next.isDirectory()) return null;
            cur = next;
        }
        return cur;
    }
}

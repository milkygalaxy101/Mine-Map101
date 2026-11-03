package id.urcifield.app;

// UrciStorage: moves bytes between the WebView, app-private storage and the user's data folder (SAF).
// All decisions (sync, merge, recovery, naming) live in JS (store.js). Proven on device by the week-1 spike.
//
// Typed reject codes: BAD_ARGS, NO_FOLDER, PERMISSION_LOST, NOT_FOUND, NAME_CLASH, NO_SPACE, NO_PICKER,
// PICKER_ERROR, CANCELLED, BAD_IMAGE, OOM, GPS_OFF, NO_FIX, PERMISSION, IO.
//
// Paths are "a/b/c" relative to the chosen folder; "", ".", ".." and absolute paths are refused.

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Bundle;
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

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

@CapacitorPlugin(name = "UrciStorage")
public class UrciStoragePlugin extends Plugin {

    private static final String PREFS = "urci_storage";
    private static final String KEY_TREE = "tree_uri";
    private static final String SAF_PREFIX = "/_saf/";
    private static final String DRAFT_DIR = "draft-photos";
    private static final long MAX_TEXT = 4L * 1024 * 1024;

    // ---------- /_saf/<path>: data-folder files served to the WebView (photos), no base64 bridge ----------
    @Override
    public void load() {
        getBridge().setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String path = request.getUrl().getPath();
                if (path != null && path.startsWith(SAF_PREFIX)) return serveSaf(path.substring(SAF_PREFIX.length()));
                return super.shouldInterceptRequest(view, request);
            }
        });
    }

    private WebResourceResponse serveSaf(String rel) {
        try {
            DocumentFile f = resolve(rel, false);
            if (f == null || !f.isFile()) return notFound();
            InputStream in = getContext().getContentResolver().openInputStream(f.getUri());
            String ext = MimeTypeMap.getFileExtensionFromUrl(f.getName());
            String mime = ext != null ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase()) : null;
            Map<String, String> headers = new HashMap<>();
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
        final Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("No folder picker on this phone (Files app disabled?)", "NO_PICKER");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                startActivityForResult(call, intent, "onFolderPicked");
            } catch (Exception e) {
                call.reject("Picker failed: " + e, "PICKER_ERROR");
            }
        });
    }

    @ActivityCallback
    private void onFolderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("cancelled", "CANCELLED");
            return;
        }
        Uri tree = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        } catch (SecurityException e) {
            call.reject("could not keep folder permission", "PERMISSION_LOST");
            return;
        }
        prefs().edit().putString(KEY_TREE, tree.toString()).apply();
        JSObject ret = new JSObject();
        ret.put("uri", tree.toString());
        ret.put("name", DocumentFile.fromTreeUri(getContext(), tree).getName());
        call.resolve(ret);
    }

    @PluginMethod
    public void folderStatus(PluginCall call) {
        DocumentFile root = root();
        JSObject ret = new JSObject();
        ret.put("hasFolder", root != null && root.exists() && root.canWrite());
        ret.put("name", root != null ? root.getName() : null);
        call.resolve(ret);
    }

    // ---------- read / list ----------
    @PluginMethod
    public void list(PluginCall call) {
        String path = call.getString("path", "");
        if (root() == null) { call.reject("no folder", "NO_FOLDER"); return; }
        DocumentFile dir = path.isEmpty() ? root() : resolve(path, false);
        if (dir == null || !dir.isDirectory()) { call.reject("not found: " + path, "NOT_FOUND"); return; }
        JSArray entries = new JSArray();
        for (DocumentFile f : dir.listFiles()) {
            JSObject e = new JSObject();
            e.put("name", f.getName());
            e.put("dir", f.isDirectory());
            entries.put(e);
        }
        JSObject ret = new JSObject();
        ret.put("entries", entries);
        call.resolve(ret);
    }

    @PluginMethod
    public void readText(PluginCall call) {
        String path = call.getString("path");
        if (path == null) { call.reject("path required", "BAD_ARGS"); return; }
        DocumentFile f = resolve(path, false);
        if (f == null || !f.isFile()) { call.reject("not found: " + path, "NOT_FOUND"); return; }
        if (f.length() > MAX_TEXT) { call.reject("file too large", "IO"); return; }
        try (InputStream in = getContext().getContentResolver().openInputStream(f.getUri())) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            JSObject ret = new JSObject();
            ret.put("text", new String(bo.toByteArray(), StandardCharsets.UTF_8));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    // ---------- write ----------
    // Crash-safe replace on SAF (ERR-1): write name.new -> rename name to name.old -> rename .new -> delete .old.
    // JS (store.decideRecovery) repairs leftovers on the next start.
    @PluginMethod
    public void writeTextSafe(PluginCall call) {
        String path = call.getString("path");
        String text = call.getString("text");
        if (path == null || text == null) { call.reject("path and text required", "BAD_ARGS"); return; }
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        if (!hasSpace(bytes.length * 2L)) { call.reject("not enough space", "NO_SPACE"); return; }
        try {
            String[] dn = splitPath(path);
            DocumentFile dir = dn[0].isEmpty() ? root() : resolve(dn[0], true);
            if (dir == null) { call.reject("no folder", root() == null ? "NO_FOLDER" : "PERMISSION_LOST"); return; }
            String name = dn[1];
            DocumentFile stale = dir.findFile(name + ".new");
            if (stale != null) stale.delete();
            DocumentFile tmp = dir.createFile("application/octet-stream", name + ".new");
            if (tmp == null) { call.reject("create failed", "IO"); return; }
            try (OutputStream out = getContext().getContentResolver().openOutputStream(tmp.getUri(), "wt")) {
                if (out == null) throw new Exception("no output stream");
                out.write(bytes);
            }
            DocumentFile existing = dir.findFile(name);
            boolean renamedOld = false;
            if (existing != null) {
                DocumentFile oldStale = dir.findFile(name + ".old");
                if (oldStale != null) oldStale.delete();
                renamedOld = existing.renameTo(name + ".old");
                if (!renamedOld) throw new Exception("could not move old file aside");
            }
            if (!tmp.renameTo(name) || !name.equals(tmp.getName())) throw new Exception("could not rename new file (got " + tmp.getName() + ")");
            if (renamedOld) {
                DocumentFile old = dir.findFile(name + ".old");
                if (old != null) old.delete();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    @PluginMethod
    public void delete(PluginCall call) {
        String path = call.getString("path");
        if (path == null) { call.reject("path required", "BAD_ARGS"); return; }
        DocumentFile f = resolve(path, false);
        if (f != null && !f.delete()) { call.reject("delete failed", "IO"); return; }
        call.resolve();
    }

    @PluginMethod
    public void rename(PluginCall call) {
        String path = call.getString("path");
        String newName = call.getString("newName");
        if (path == null || newName == null || newName.contains("/") || !safeSegment(newName)) { call.reject("bad args", "BAD_ARGS"); return; }
        DocumentFile f = resolve(path, false);
        if (f == null) { call.reject("not found: " + path, "NOT_FOUND"); return; }
        DocumentFile parent = f.getParentFile();
        if (parent != null && parent.findFile(newName) != null) { call.reject("exists: " + newName, "NAME_CLASH"); return; }
        if (!f.renameTo(newName) || !newName.equals(f.getName())) { call.reject("rename failed", "IO"); return; }
        call.resolve();
    }

    // ---------- photos ----------
    // Draft photos live in app-private files/draft-photos until Save (eng R6).
    @PluginMethod
    public void writeDraftPhoto(PluginCall call) {
        String b64 = call.getString("base64");
        if (b64 == null) { call.reject("base64 required", "BAD_ARGS"); return; }
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            File dir = new File(getContext().getFilesDir(), DRAFT_DIR);
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create draft dir");
            if (dir.getUsableSpace() < bytes.length * 2L) { call.reject("not enough space", "NO_SPACE"); return; }
            File f = new File(dir, UUID.randomUUID() + ".jpg");
            try (FileOutputStream fo = new FileOutputStream(f)) { fo.write(bytes); }
            JSObject ret = new JSObject();
            ret.put("path", f.getAbsolutePath());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    @PluginMethod
    public void deleteDraftPhoto(PluginCall call) {
        File f = draftFile(call.getString("path"));
        if (f == null) { call.reject("not a draft photo", "BAD_ARGS"); return; }
        if (f.exists() && !f.delete()) { call.reject("delete failed", "IO"); return; }
        call.resolve();
    }

    // Copy a draft photo into the data folder with create-new semantics (never overwrite; SAF would auto-rename).
    @PluginMethod
    public void copyDraftIn(PluginCall call) {
        File src = draftFile(call.getString("from"));
        String dest = call.getString("to");
        if (src == null || dest == null) { call.reject("bad args", "BAD_ARGS"); return; }
        if (!src.exists()) { call.reject("draft missing", "NOT_FOUND"); return; }
        if (!hasSpace(src.length() * 2L)) { call.reject("not enough space", "NO_SPACE"); return; }
        try {
            String[] dn = splitPath(dest);
            DocumentFile dir = resolve(dn[0], true);
            if (dir == null) { call.reject("no folder", root() == null ? "NO_FOLDER" : "PERMISSION_LOST"); return; }
            if (dir.findFile(dn[1]) != null) { call.reject("exists: " + dn[1], "NAME_CLASH"); return; }
            DocumentFile out = dir.createFile("image/jpeg", dn[1]);
            if (out == null) throw new Exception("create failed");
            if (!dn[1].equals(out.getName())) { out.delete(); call.reject("name changed by provider", "NAME_CLASH"); return; }
            try (InputStream in = new FileInputStream(src); OutputStream os = getContext().getContentResolver().openOutputStream(out.getUri(), "wt")) {
                if (os == null) throw new Exception("no output stream");
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    // Downscale at capture (eng R7): the camera ignores targetWidth for the file at uri (spike run 1).
    // Bounds pass, power-of-two inSampleSize keeping the long edge >= 3/4 maxEdge, exact scale, EXIF rotation.
    @PluginMethod
    public void downscale(PluginCall call) {
        String src = call.getString("uri");
        int maxEdge = call.getInt("maxEdge", 2048);
        int quality = call.getInt("quality", 92);
        if (src == null) { call.reject("uri required", "BAD_ARGS"); return; }
        Uri uri = src.startsWith("/") ? Uri.fromFile(new File(src)) : Uri.parse(src);
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) { BitmapFactory.decodeStream(in, null, bounds); }
            int sw = bounds.outWidth, sh = bounds.outHeight;
            if (sw <= 0 || sh <= 0) { call.reject("not an image", "BAD_IMAGE"); return; }
            int sample = 1;
            while (Math.max(sw, sh) / (sample * 2) >= maxEdge * 3 / 4) sample *= 2;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            Bitmap bmp;
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) { bmp = BitmapFactory.decodeStream(in, null, opts); }
            if (bmp == null) { call.reject("decode failed", "BAD_IMAGE"); return; }
            int rotation = 0;
            try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
                int o = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
                rotation = o == ExifInterface.ORIENTATION_ROTATE_90 ? 90 : o == ExifInterface.ORIENTATION_ROTATE_180 ? 180 : o == ExifInterface.ORIENTATION_ROTATE_270 ? 270 : 0;
            } catch (Exception ignored) { }
            float scale = Math.min(1f, (float) maxEdge / Math.max(bmp.getWidth(), bmp.getHeight()));
            Matrix m = new Matrix();
            m.postScale(scale, scale);
            if (rotation != 0) m.postRotate(rotation);
            Bitmap out = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
            if (out != bmp) bmp.recycle();
            File dir = new File(getContext().getCacheDir(), "pending");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create cache dir");
            File dst = new File(dir, "ds-" + UUID.randomUUID() + ".jpg");
            try (FileOutputStream fo = new FileOutputStream(dst)) { out.compress(Bitmap.CompressFormat.JPEG, quality, fo); }
            JSObject ret = new JSObject();
            ret.put("path", dst.getAbsolutePath());
            ret.put("width", out.getWidth());
            ret.put("height", out.getHeight());
            out.recycle();
            call.resolve(ret);
        } catch (OutOfMemoryError e) {
            call.reject("out of memory", "OOM");
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    // Exports (PDF, later xlsx/zip): write to app cache (shareable via FileProvider) and copy into
    // <data folder>/exports/ with create-new semantics; a clash gets "-2", "-3", ... before the extension.
    @PluginMethod
    public void saveExport(PluginCall call) {
        String name = call.getString("name");
        String b64 = call.getString("base64");
        String mime = call.getString("mime", "application/pdf");
        if (name == null || b64 == null || !safeSegment(name) || name.contains("/")) { call.reject("bad args", "BAD_ARGS"); return; }
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            if (!hasSpace(bytes.length * 3L)) { call.reject("not enough space", "NO_SPACE"); return; }
            File dir = new File(getContext().getCacheDir(), "exports");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("cannot create cache dir");
            File cache = new File(dir, name);
            try (FileOutputStream fo = new FileOutputStream(cache)) { fo.write(bytes); }
            DocumentFile exports = resolve("exports", true);
            if (exports == null) { call.reject("no folder", root() == null ? "NO_FOLDER" : "PERMISSION_LOST"); return; }
            int dot = name.lastIndexOf('.');
            String base = dot > 0 ? name.substring(0, dot) : name, ext = dot > 0 ? name.substring(dot) : "";
            String finalName = name;
            for (int i = 2; exports.findFile(finalName) != null; i++) finalName = base + "-" + i + ext;
            DocumentFile out = exports.createFile(mime, finalName);
            if (out == null) throw new Exception("create failed");
            try (OutputStream os = getContext().getContentResolver().openOutputStream(out.getUri(), "wt")) {
                if (os == null) throw new Exception("no output stream");
                os.write(bytes);
            }
            JSObject ret = new JSObject();
            ret.put("cachePath", cache.getAbsolutePath());
            ret.put("relPath", "exports/" + out.getName());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "IO");
        }
    }

    // ---------- device ----------
    @PluginMethod
    public void freeSpace(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("freeBytes", new StatFs(getContext().getFilesDir().getPath()).getAvailableBytes());
        call.resolve(ret);
    }

    // Native GPS fallback for phones without Play Services (eng R8); also gives GPS time for the clock check.
    @PluginMethod
    public void nativeFix(PluginCall call) {
        final LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        final int timeoutMs = call.getInt("timeoutMs", 10000);
        final long t0 = System.currentTimeMillis();
        if (lm == null || !lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) { call.reject("gps off", "GPS_OFF"); return; }
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
            @Override public void onStatusChanged(String p, int s, Bundle b) { }
            @Override public void onProviderEnabled(String p) { }
            @Override public void onProviderDisabled(String p) { }
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
        DocumentFile r = DocumentFile.fromTreeUri(getContext(), Uri.parse(s));
        return r != null && r.exists() ? r : null;
    }

    private static boolean safeSegment(String p) {
        return !p.isEmpty() && !p.equals(".") && !p.equals("..") && !p.contains("\\") && !p.contains("\0");
    }

    private static String[] splitPath(String path) {
        int slash = path.lastIndexOf('/');
        return new String[] { slash >= 0 ? path.substring(0, slash) : "", slash >= 0 ? path.substring(slash + 1) : path };
    }

    private DocumentFile resolve(String rel, boolean createDirs) {
        DocumentFile cur = root();
        if (cur == null || rel == null || rel.startsWith("/")) return null;
        String[] parts = rel.split("/", -1);
        for (int i = 0; i < parts.length; i++) {
            String p = parts[i];
            if (!safeSegment(p)) return null; // no traversal, no empty segments
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

    private File draftFile(String path) {
        if (path == null) return null;
        try {
            File dir = new File(getContext().getFilesDir(), DRAFT_DIR).getCanonicalFile();
            File f = new File(path).getCanonicalFile();
            return dir.equals(f.getParentFile()) ? f : null;
        } catch (Exception e) {
            return null;
        }
    }

    private boolean hasSpace(long need) {
        try {
            return new StatFs(getContext().getFilesDir().getPath()).getAvailableBytes() > need;
        } catch (Exception e) {
            return true;
        }
    }
}

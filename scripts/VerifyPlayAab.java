import java.io.File;
import java.io.InputStream;
import java.security.KeyStore;
import java.security.CodeSigner;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.Locale;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/** Read every entry so the JAR verifier checks its signature before release. */
class VerifyPlayAab {
  private static boolean signatureMetadata(String name) {
    String upper = name.toUpperCase(Locale.ROOT);
    if (!upper.startsWith("META-INF/")) return false;
    String leaf = upper.substring("META-INF/".length());
    if (leaf.contains("/")) return false;
    return leaf.equals("MANIFEST.MF") || leaf.endsWith(".SF") || leaf.endsWith(".RSA") ||
      leaf.endsWith(".DSA") || leaf.endsWith(".EC") || leaf.startsWith("SIG-");
  }
  public static void main(String[] args) {
    char[] password = null;
    try {
      if (args.length != 1) throw new Exception();
      String location = System.getenv("TPV_PLAY_KEYSTORE"), alias = System.getenv("TPV_PLAY_KEY_ALIAS"), secret = System.getenv("TPV_PLAY_STORE_PASSWORD");
      if (location == null || alias == null || secret == null) throw new Exception();
      password = secret.toCharArray();
      KeyStore store = KeyStore.getInstance(new File(location), password);
      Certificate expected = store.getCertificate(alias);
      if (!(expected instanceof X509Certificate)) throw new Exception();
      ((X509Certificate) expected).checkValidity();
      byte[] target = expected.getEncoded();
      boolean config = false, manifest = false;
      try (JarFile jar = new JarFile(new File(args[0]), true)) {
        Enumeration<JarEntry> entries = jar.entries();
        while (entries.hasMoreElements()) {
          JarEntry entry = entries.nextElement();
          if (entry.isDirectory()) continue;
          try (InputStream stream = jar.getInputStream(entry)) { stream.transferTo(java.io.OutputStream.nullOutputStream()); }
          String name = entry.getName();
          config |= name.equals("BundleConfig.pb");
          manifest |= name.equals("base/manifest/AndroidManifest.xml");
          if (signatureMetadata(name)) continue;
          CodeSigner[] signers = entry.getCodeSigners();
          if (signers == null || signers.length != 1) throw new Exception();
          boolean matched = false;
          if (signers != null) for (CodeSigner signer : signers) {
            var chain = signer.getSignerCertPath().getCertificates();
            if (!chain.isEmpty() && Arrays.equals(chain.get(0).getEncoded(), target)) matched = true;
          }
          if (!matched) throw new Exception();
        }
      }
      if (!config || !manifest) throw new Exception();
    } catch (Exception error) {
      System.err.println("Play bundle signature verification failed.");
      System.exit(1);
    } finally { if (password != null) Arrays.fill(password, (char) 0); }
  }
}

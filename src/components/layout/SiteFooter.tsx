/**
 * Site footer — the copyright line, and nothing else.
 *
 * The four link columns (About / Categories / Resources / Connect) were removed
 * deliberately, and most of them led nowhere useful: every Connect link was
 * href="#", and /team, /mission, /podcasts and /videos have no page of their own.
 * They do not 404 either — the catch-all [topic] segment answers any unmatched
 * slug with an empty portal, so those links returned a bare 200 with no content,
 * which is the harder failure to notice. If any of these come back, they come
 * back one at a time, as their destinations become real.
 */
export default function SiteFooter() {
  return (
    <footer className="footer">
      <div className="footer-bottom">
        <p>&copy; 2026 JubileeVerse. Part of the Jubilee Enterprise Network. All rights reserved.</p>
      </div>
    </footer>
  );
}

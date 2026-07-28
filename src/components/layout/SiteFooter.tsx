import Link from 'next/link';

const SECTIONS = [
  {
    title: 'About',
    links: [
      { label: 'About Us', href: '/about' },
      { label: 'Our Team', href: '/team' },
      { label: 'Our Mission', href: '/mission' },
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    title: 'Categories',
    links: [
      { label: 'Devotionals', href: '/devotionals' },
      { label: 'Sermons', href: '/sermons' },
      { label: 'Faith Stories', href: '/faith' },
      { label: 'Community', href: '/community' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { label: 'Bible Study', href: '/bible' },
      { label: 'Prayer Requests', href: '/prayer' },
      { label: 'Podcasts', href: '/podcasts' },
      { label: 'Videos', href: '/videos' },
    ],
  },
  {
    title: 'Connect',
    links: [
      { label: 'Facebook', href: '#' },
      { label: 'Twitter', href: '#' },
      { label: 'Instagram', href: '#' },
      { label: 'YouTube', href: '#' },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        {SECTIONS.map((section) => (
          <div className="footer-section" key={section.title}>
            <h4>{section.title}</h4>
            <ul className="footer-links">
              {section.links.map((link) => (
                <li key={link.label}>
                  <Link href={link.href}>{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="footer-bottom">
        <p>&copy; 2026 JubileeVerse. Part of the Jubilee Enterprise Network. All rights reserved.</p>
      </div>
    </footer>
  );
}

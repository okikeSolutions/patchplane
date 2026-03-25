import { Link } from '@tanstack/react-router'
import * as m from '@/paraglide/messages'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="page-wrap site-footer__inner">
        <div className="site-footer__copy">
          <p className="site-footer__brand">PatchPlane</p>
          <p>{m.footer_description()}</p>
        </div>

        <div className="site-footer__meta">
          <div className="site-footer__links">
            <Link to="/">{m.header_nav_landing()}</Link>
            <Link to="/app">{m.header_nav_product()}</Link>
            <Link to="/about">{m.header_nav_architecture()}</Link>
            <a
              href="https://github.com/okikeSolutions/patchplane"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </div>
          <p>&copy; {year} PatchPlane</p>
        </div>
      </div>
    </footer>
  )
}

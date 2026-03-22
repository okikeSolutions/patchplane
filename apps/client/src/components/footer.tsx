import { Link } from '@tanstack/react-router'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer">
      <div className="page-wrap site-footer__inner">
        <div className="site-footer__copy">
          <p className="site-footer__brand">PatchPlane</p>
          <p>
            Coordinate requests, runtime events, reviews, and merge decisions in
            one operational thread.
          </p>
        </div>

        <div className="site-footer__meta">
          <div className="site-footer__links">
            <Link to="/">Landing</Link>
            <Link to="/app">Product</Link>
            <Link to="/about">Architecture</Link>
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

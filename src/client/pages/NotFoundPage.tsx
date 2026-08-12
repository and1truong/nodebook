import { Link } from "../router";

export function NotFoundPage() {
  return (
    <div className="state empty">
      <h1>404</h1>
      <p>That page does not exist.</p>
      <Link to="/inbox" className="btn">
        Back to Inbox
      </Link>
    </div>
  );
}

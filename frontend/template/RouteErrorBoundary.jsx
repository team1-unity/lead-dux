import { Component } from 'react';
import { Link } from 'react-router-dom';

// Wraps <Outlet/> only (see AppShell in App.jsx) — never BottomNav — so an
// uncaught error in one page's render can't take the whole app down with
// it. Without this, React unmounts everything up to the nearest boundary
// on an uncaught error; since there was none, that meant the whole tree,
// nav included, leaving someone stuck with no way out short of an address-
// bar edit. A class component because error boundaries have no hook
// equivalent yet.
export class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  // Reset whenever the route changes (App.jsx passes the current pathname
  // as `resetKey`) — otherwise navigating to a different page while still
  // showing the fallback would keep rendering the fallback instead of the
  // new page.
  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="quest-empty">
          <h2>Something went wrong on this page</h2>
          <p>Use the nav below to head somewhere else, or try reloading.</p>
          <Link to="/">Back to home</Link>
        </div>
      );
    }
    return this.props.children;
  }
}

import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@shared/AuthContext.jsx';
import { useMapQuestSeries } from '@shared/useMapQuestSeries.js';
import { PageMotion } from '@shared/PageMotion.jsx';
import { LoadingSpinner } from '@shared/LoadingSpinner.jsx';
import { BackLink } from '@shared/BackLink.jsx';
import { SinglePinMap } from '@shared/SinglePinMap.jsx';
import { MapQuestDetailBody } from '@shared/MapQuestDetailBody.jsx';

// The standalone full-page fallback for a quest's map detail — what renders
// when /map/:seriesId is loaded directly (a shared link, a page refresh, no
// react-router history to fall back on) rather than opened as a floating
// overlay from within EventsMap itself (see MapQuestOverlay.jsx and
// App.jsx's backgroundLocation routing, which is what renders instead
// whenever this same path is reached by clicking a row/pin on /map).
export function MapQuestPage() {
  const { seriesId } = useParams();
  const { user, loading } = useAuth();
  const { series, notFound, error } = useMapQuestSeries(seriesId);

  if (notFound) return <Navigate to="/map" replace />;
  if (error) {
    return (
      <PageMotion>
        <BackLink to="/map" label="Map" />
        <p className="box-danger">{error}</p>
      </PageMotion>
    );
  }
  // Same ordering QuestDetails.jsx uses and explains: on a hard reload,
  // Firebase Auth hasn't resolved `user` yet even after this page's own
  // (auth-independent) fetch finishes, so this waits on both rather than
  // just `series`.
  if (loading || !series) return <LoadingSpinner label="Loading quest…" />;
  if (!user) return <Navigate to="/login" replace />;

  return (
    <PageMotion>
      <BackLink to="/map" label="Map" />
      <div className="ink-card">
        <SinglePinMap
          lat={series.primary.lat}
          lng={series.primary.lng}
          seed={series.primary.orgId || series.seriesId}
        />
        <MapQuestDetailBody series={series} fullDetailsHref={`/quests/${series.seriesId}`} />
      </div>
    </PageMotion>
  );
}

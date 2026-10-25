import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import Landing from './pages/Landing';
import { FlowLayout, TabsLayout } from './components/app/AppShell';
import { useSession } from './state/SessionContext';

// App screens load on demand so the landing page stays light.
const DesignSystem = lazy(() => import('./pages/DesignSystem'));
const Welcome = lazy(() => import('./pages/app/Welcome'));
const ConnectBank = lazy(() => import('./pages/app/ConnectBank'));
const ConnectProgress = lazy(() => import('./pages/app/ConnectProgress'));
const Questionnaire = lazy(() => import('./pages/app/Questionnaire'));
const ImportStatement = lazy(() => import('./pages/app/ImportStatement'));
const Analysis = lazy(() => import('./pages/app/Analysis'));
const Plan = lazy(() => import('./pages/app/Plan'));
const NewGoal = lazy(() => import('./pages/app/NewGoal'));
const PlanFlow = lazy(() => import('./pages/app/PlanFlow'));
const Stocks = lazy(() => import('./pages/app/Stocks').then((m) => ({ default: m.StocksList })));
const StockDetail = lazy(() => import('./pages/app/Stocks').then((m) => ({ default: m.StockDetail })));
const News = lazy(() => import('./pages/app/News'));
const Profile = lazy(() => import('./pages/app/Profile'));
const Privacy = lazy(() => import('./pages/app/Privacy'));
const Simulator = lazy(() => import('./pages/app/Simulator'));
const DemoLink = lazy(() => import('./pages/app/DemoLink').then((m) => ({ default: m.DemoLink })));

/** Screens that need an active consent session bounce to Welcome. */
function RequireSession({ children }: { children: ReactNode }) {
  const { session } = useSession();
  if (!session) return <Navigate to="/app/welcome" replace />;
  return children;
}

/** /app/plan/:step — only the four plan steps; anything else goes back to the Plan tab. */
function PlanStep() {
  const { step } = useParams();
  return ['buffer', 'mission', 'stress', 'decide'].includes(step ?? '') ? <PlanFlow /> : <Navigate to="/app/plan" replace />;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-night" />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/design" element={<DesignSystem />} />

        <Route path="/app" element={<RequireSession><TabsLayout /></RequireSession>}>
          <Route index element={<Navigate to="/app/analysis" replace />} />
          <Route path="analysis" element={<Analysis />} />
          <Route path="plan" element={<Plan />} />
          <Route path="plan/:step" element={<PlanStep />} />
          <Route path="stocks" element={<Stocks />} />
          <Route path="stocks/:ticker" element={<StockDetail />} />
          <Route path="news" element={<News />} />
          <Route path="profile" element={<Profile />} />
          <Route path="profile/privacy" element={<Privacy />} />
          {/* Earlier URLs (Home / Goals / Alerts / Privacy tabs) keep working. */}
          <Route path="goals" element={<Navigate to="/app/plan" replace />} />
          <Route path="goals/goal" element={<Navigate to="/app/plan" replace />} />
          <Route path="alerts" element={<Navigate to="/app/news" replace />} />
          <Route path="privacy" element={<Navigate to="/app/profile/privacy" replace />} />
        </Route>

        <Route path="/app" element={<FlowLayout />}>
          <Route path="welcome" element={<Welcome />} />
          <Route path="demo/:persona" element={<DemoLink />} />
          <Route path="connect" element={<ConnectBank />} />
          <Route path="connect/progress" element={<RequireSession><ConnectProgress /></RequireSession>} />
          <Route path="plan/edit" element={<RequireSession><NewGoal /></RequireSession>} />
          <Route path="goals/new" element={<Navigate to="/app/plan/edit" replace />} />
          <Route path="questionnaire" element={<Questionnaire />} />
          <Route path="import" element={<ImportStatement />} />
          <Route path="sandbox" element={<RequireSession><Simulator /></RequireSession>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

import { AppErrorBoundary } from './AppErrorBoundary';
import { AppShell } from './AppShell';
import { TooltipLayer } from '../components/ui/TooltipLayer';

export function App() {
  return (
    <AppErrorBoundary>
      <AppShell />
      <TooltipLayer />
    </AppErrorBoundary>
  );
}

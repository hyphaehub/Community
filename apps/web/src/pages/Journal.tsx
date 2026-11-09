import { LogFeed } from '../components/LogEntries';
import { PageHeader } from '../components/ui';

export function Journal() {
  return (
    <div>
      <PageHeader
        title="Journal"
        subtitle="A running log of your grow — observations, tweaks, and conditions, with photos. Tie an entry to a batch or keep it as a general note."
      />
      <LogFeed />
    </div>
  );
}

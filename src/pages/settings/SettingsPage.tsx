import { useEffect } from 'react';
import { PageHero } from '@/components/layout/PageHero';
import { SectionNav } from '@/components/nav/SectionNav';
import { useRoute } from '@/app/router';
import { useSettings } from '@/hooks/useStore';
import { goToSection, useScrollSpy } from '@/features/navigation/scrollSpy';
import { AppearanceSection, FocusSection, LayoutSection, NotificationsSection } from './PreferenceSections';
import { IntegrationsSection } from './IntegrationsSection';
import { AboutSection, DataSection, PrivacySection } from './DataSections';

const SECTIONS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'layout', label: 'Layout & Navigation' },
  { id: 'focus', label: 'Focus' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'data', label: 'Data & Backup' },
  { id: 'account', label: 'Account & About' },
];
const IDS = SECTIONS.map((s) => s.id);
const sectionEl = (id: string) => document.getElementById(`settings-${id}`);
const hrefFor = (id: string) => `#/settings?section=${id}`;

export default function SettingsPage() {
  const [settings, , loaded] = useSettings();
  const { params } = useRoute();
  const section = params.get('section');
  const { active, setActive } = useScrollSpy(IDS, { getElement: sectionEl, enabled: loaded });

  // Deep links (#/settings?section=…) from elsewhere in the app.
  useEffect(() => {
    if (!loaded || !section || !IDS.includes(section)) return;
    setActive(section);
    goToSection(sectionEl(section), document.getElementById(`settings-${section}-title`));
  }, [section, loaded, setActive]);

  const select = (id: string) => {
    setActive(id);
    // Keep the URL shareable without stacking history entries or re-triggering the route effect.
    window.history.replaceState(window.history.state, '', hrefFor(id));
    goToSection(sectionEl(id), document.getElementById(`settings-${id}-title`));
  };

  return (
    <div>
      <PageHero title="Settings & Appearance" subtitle="Customize your workspace, connect your tools, and make it yours." />
      <div className="flex items-start gap-6">
        <SectionNav label="Settings sections" items={SECTIONS} active={active} onSelect={select} hrefFor={hrefFor} className="sticky top-4 w-48 shrink-0 self-start max-lg:hidden" />
        <div className="flex min-w-0 max-w-4xl flex-1 flex-col gap-5">
          {!loaded ? (
            <p role="status" className="text-sm text-muted">
              Loading settings…
            </p>
          ) : (
            <>
              <AppearanceSection settings={settings} />
              <LayoutSection settings={settings} />
              <FocusSection settings={settings} />
              <NotificationsSection settings={settings} />
              <IntegrationsSection settings={settings} />
              <PrivacySection settings={settings} />
              <DataSection />
              <AboutSection settings={settings} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

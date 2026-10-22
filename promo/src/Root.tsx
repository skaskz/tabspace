import { Composition, Folder } from 'remotion';
import { TabspacePromo } from './TabspacePromo';
import { Bar } from './scenes/Bar';
import { Customize } from './scenes/Customize';
import { Focus } from './scenes/Focus';
import { Grid } from './scenes/Grid';
import { Intro } from './scenes/Intro';
import { NewTab } from './scenes/NewTab';
import { Outro } from './scenes/Outro';
import { Tagline } from './scenes/Tagline';
import { TasksNotes } from './scenes/TasksNotes';
import { Workspaces } from './scenes/Workspaces';
import { FPS, H, SCENES, TOTAL, W } from './theme';

const SCENE_COMPONENTS = { intro: Intro, tagline: Tagline, newtab: NewTab, workspaces: Workspaces, tasks: TasksNotes, focus: Focus, bar: Bar, customize: Customize, grid: Grid, outro: Outro } as const;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="TabspacePromo" component={TabspacePromo} width={W} height={H} fps={FPS} durationInFrames={TOTAL} />
    <Folder name="Scenes">
      {SCENES.map((s) => (
        <Composition key={s.id} id={`Scene-${s.id}`} component={SCENE_COMPONENTS[s.id]} width={W} height={H} fps={FPS} durationInFrames={s.dur} />
      ))}
    </Folder>
  </>
);

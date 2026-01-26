// TypeScript tabs demo
import { createApp, melker } from '../mod.ts';

const ui = melker`
  <container id="root" style="display: flex; flex-direction: column; padding: 1; border: thin;">
    <text id="title" style="font-weight: bold;">Tabs Demo</text>
    <tabs id="demo-tabs" activeTab="0">
      <tab title="General">
        <text>General Settings content</text>
      </tab>
      <tab title="Advanced">
        <text>Advanced Settings content</text>
      </tab>
      <tab title="About">
        <text>About content</text>
      </tab>
    </tabs>
    <text style="color: gray;">Use Tab key to navigate, Enter to select.</text>
  </container>
`;

const engine = await createApp(ui);

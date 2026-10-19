import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PickerPanelWindow } from './components/ObjectPicker/PickerPanelWindow';
import { PickerHighlightOverlay } from './components/ObjectPicker/PickerHighlightOverlay';
import { AgentManagerWindow } from './components/AgentManager/AgentManagerWindow';
import { RunnerSettingsWindow } from './components/AgentManager/RunnerSettingsWindow';
import { I18nProvider } from './i18n';
import './index.css';

const params = new URLSearchParams(window.location.search);
const mode = params.get('mode');

function RootComponent() {
  if (mode === 'picker_panel') {
    return <PickerPanelWindow />;
  }
  if (mode === 'picker_overlay') {
    return <PickerHighlightOverlay />;
  }
  if (mode === 'agent_manager') {
    return <AgentManagerWindow />;
  }
  if (mode === 'runner_settings') {
    return <RunnerSettingsWindow />;
  }
  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <RootComponent />
    </I18nProvider>
  </React.StrictMode>
);

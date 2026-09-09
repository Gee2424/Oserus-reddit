import React from 'react';
import PageHeader from '../components/PageHeader.jsx';
import { EmptyState } from '../components/ui.jsx';

// Placeholder for the Scripts feature (WS-I): named content "Sets" per model,
// made of ordered "Steps" (photo/video + message) that chatters send in order
// during a chat. Not built yet — this stub reserves the route + sidebar slot.
export default function ScriptsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Workspace"
        title="Scripts"
        subtitle="Named content Sets per model — ordered Steps (media + message) that chatters send in sequence."
      />
      <EmptyState
        icon="◫"
        title="Scripts aren't set up yet"
        hint="This is where you'll build content Sets for each model and assign which chatters can use them. Coming in a later update."
      />
    </div>
  );
}

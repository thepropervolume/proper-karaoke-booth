import React, { useState } from 'react';
import { preferenceTopicMatches } from './preference-search';

export type PreferenceTopic = { id?: string; title?: string; keywords: string; controls: React.ReactNode };

export function PreferenceCategory({ id, title, topics, terms, open, onToggle }: {
  id: string; title: string; topics: PreferenceTopic[]; terms: readonly string[]; open: boolean; onToggle: () => void;
}) {
  const [collapsedSearch, setCollapsedSearch] = useState('');
  const search = terms.join(' ');
  const matches = topics.map(topic => preferenceTopicMatches(terms, title, topic.title ?? '', topic.keywords));
  const expanded = search ? collapsedSearch !== search : open;
  return <details className="settings-group" data-settings-section={id} open={expanded} hidden={!matches.some(Boolean)}>
    <summary onClick={event => {
      event.preventDefault();
      if (search) setCollapsedSearch(expanded ? search : '');
      else onToggle();
    }}>{title}</summary>
    <div className="settings-group__content">
      {topics.map((topic, index) => <section className="preference-topic" key={topic.id ?? index} hidden={!matches[index]}
        data-settings-section={topic.id}>
        {topic.title && <h3 tabIndex={-1}>{topic.title}</h3>}
        {topic.controls}
      </section>)}
    </div>
  </details>;
}

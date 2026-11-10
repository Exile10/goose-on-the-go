/**
 * The member's interests as a grouped list: a picture tile (or the topic's initial), the topic and
 * the angles Goose follows, guesses to confirm or dismiss, and in Edit, controls to reorder, mute
 * or remove each. Shared by My Goose's foot and the interests screen.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { initialOf, type Interest } from '@/models/interests';
import { selectionTick } from '@/services/haptics';
import type { UseInterests } from '@/view-models/use-interests';
import { GroupRow, InsetGroup } from './following';
import { RoundButton } from './hub-parts';

function go(href: Parameters<typeof router.push>[0]) {
  void selectionTick();
  router.push(href);
}

export function InterestsGroup({ interests, editing, onAdd }: { interests: UseInterests; editing: boolean; onAdd: () => void }) {
  const { t } = useTranslation();
  const { confirmed, guesses } = interests.groups;
  const { actions } = interests;

  const controls = (interest: Interest, index: number) => (
    <View style={styles.controls}>
      <RoundButton icon="chevron-up" size={30} label={t('goose.following.moveUp', { topic: interest.topic })} onPress={() => actions.move(interest.id, -1)} style={index === 0 ? styles.faded : null} />
      <RoundButton icon="chevron" size={30} label={t('goose.following.moveDown', { topic: interest.topic })} onPress={() => actions.move(interest.id, 1)} style={index === confirmed.length - 1 ? styles.faded : null} />
      <RoundButton
        icon={interest.news === 'off' ? 'volume' : 'volume-off'}
        size={30}
        label={interest.news === 'off' ? t('goose.following.unmute', { topic: interest.topic }) : t('goose.following.mute', { topic: interest.topic })}
        onPress={() => void actions.setFollowing(interest, interest.news === 'off')}
      />
      <RoundButton icon="trash" size={30} label={t('goose.following.remove', { topic: interest.topic })} onPress={() => void actions.remove(interest)} />
    </View>
  );

  return (
    <InsetGroup>
      {confirmed.map((interest, i) => (
        <GroupRow
          key={interest.id}
          first={i === 0}
          picture={interest.picture}
          initial={initialOf(interest.topic)}
          label={interest.topic}
          detail={interest.news === 'off' ? t('goose.following.muted') : interest.facets.slice(0, 3).join(', ') || null}
          muted={interest.news === 'off'}
          onPress={() => go({ pathname: '/(stack)/goose-interest', params: { id: interest.id } })}
          trailing={editing ? controls(interest, i) : undefined}
        />
      ))}
      {guesses.map((guess, i) => (
        <GroupRow
          key={guess.id}
          first={confirmed.length === 0 && i === 0}
          picture={guess.picture}
          initial={initialOf(guess.topic)}
          label={guess.topic}
          detail={t('goose.following.guess')}
          trailing={
            <View style={styles.controls}>
              <RoundButton icon="check" size={30} label={t('goose.following.confirm', { topic: guess.topic })} onPress={() => void actions.confirmGuess(guess)} />
              <RoundButton icon="x" size={30} label={t('goose.following.dismiss', { topic: guess.topic })} onPress={() => void actions.remove(guess)} />
            </View>
          }
        />
      ))}
      <GroupRow first={confirmed.length + guesses.length === 0} icon="plus" label={t('goose.following.add')} onPress={onAdd} />
      <GroupRow icon="chat" label={t('goose.following.tellMore')} onPress={() => go('/(stack)/goose-interview')} />
    </InsetGroup>
  );
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', gap: 6 },
  faded: { opacity: 0.35 },
});

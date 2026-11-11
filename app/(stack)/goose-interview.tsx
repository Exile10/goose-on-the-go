/**
 * The interests interview, reached from My Goose and from the interests screen. When the member
 * saves what Goose drafted, it goes back to where they came from.
 */

import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useInkTheme } from '@jarida/ink/native';

import { InterviewChat } from '@/components/goose/interview-chat';
import { useInterestsInterview } from '@/view-models/use-interests-interview';

export default function GooseInterviewScreen() {
  const theme = useInkTheme();
  const vm = useInterestsInterview();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg }}>
      <InterviewChat vm={vm} onFinished={() => router.back()} />
    </View>
  );
}

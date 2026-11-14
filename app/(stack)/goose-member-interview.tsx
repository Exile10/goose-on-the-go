/**
 * The member's interview with the Pond: eight short sections of tap answers, then what Goose would
 * keep, for them to approve. Reached from My Goose; when it is done it points at About you.
 */

import React from 'react';
import { router } from 'expo-router';

import { MemberInterviewView } from '@/components/goose/member-interview';
import { useMemberInterview } from '@/view-models/use-member-interview';

export default function GooseMemberInterviewScreen() {
  const vm = useMemberInterview();
  return <MemberInterviewView vm={vm} onSeeAbout={() => router.push('/(stack)/goose-about')} />;
}

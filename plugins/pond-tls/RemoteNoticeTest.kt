package io.jarida.pondtls

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** The remote-access notice says "Connected" only when the Pond has answered. */
class RemoteNoticeTest {
  @Test fun aNodeStillJoiningIsConnecting() {
    assertEquals(RemoteNotice.CONNECTING, RemoteNotice.of(false, emptyList()))
    // Even with the Pond answering on its local address: remote access is not up yet.
    assertEquals(RemoteNotice.CONNECTING, RemoteNotice.of(false, listOf(true)))
  }

  @Test fun aRunningNodeIsNotYetAConnection() {
    // The case seen on 2026-10-27: node Running, no Pond asked or answering.
    assertEquals(RemoteNotice.CONNECTING, RemoteNotice.of(true, emptyList()))
  }

  @Test fun anAnswerFromAnyAddressIsConnected() {
    assertEquals(RemoteNotice.CONNECTED, RemoteNotice.of(true, listOf(true)))
    assertEquals(RemoteNotice.CONNECTED, RemoteNotice.of(true, listOf(false, true)))
  }

  @Test fun noAnswerFromEveryAddressIsUnreachable() {
    assertEquals(RemoteNotice.UNREACHABLE, RemoteNotice.of(true, listOf(false)))
    assertEquals(RemoteNotice.UNREACHABLE, RemoteNotice.of(true, listOf(false, false)))
  }

  @Test fun onlyConnectedSaysConnected() {
    for (notice in RemoteNotice.values().filter { it != RemoteNotice.CONNECTED }) {
      assertFalse(notice.title.startsWith("Connected"))
      assertFalse(notice.body.contains("from anywhere"))
    }
  }
}

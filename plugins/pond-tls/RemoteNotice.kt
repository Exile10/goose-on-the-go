package io.jarida.pondtls

/**
 * What the remote-access notification says, decided from what this phone actually knows.
 *
 * Two signals, neither of which is enough alone. The embedded node's own state says whether
 * this phone is on the tailnet at all; "Running" means the node has joined it, and says nothing
 * about the Pond. Whether the Pond answers is what the user reads "Connected" as, and only the
 * requests the app makes to it can tell: [PondNetwork.observe] records, for each pinned Pond
 * origin, whether the last request to it got an answer. The notice used to follow the node
 * alone, so it read "Connected to your Pond" on 2026-10-27 on a phone with no Pond in reach.
 *
 * Kept free of Android types so it is unit-tested on the JVM (`RemoteNoticeTest`).
 */
enum class RemoteNotice(val title: String, val body: String) {
  /** The node is still joining the tailnet, or nothing has asked the Pond anything yet. */
  CONNECTING("Connecting to your Pond", "Remote access is on. Looking for your Pond."),

  /** The node is up and the Pond answered the last request to at least one of its addresses. */
  CONNECTED("Connected to your Pond", "Remote access is on, so you can reach your Pond from anywhere."),

  /** The node is up, but the last request to every address the Pond has went unanswered. */
  UNREACHABLE("Can't reach your Pond", "Remote access is on, but your Pond is not answering.");

  companion object {
    /**
     * [nodeRunning] is the node's state being "Running". [answers] holds, per Pond origin,
     * whether its last request was answered. Any one answering is enough: at home the Pond is
     * reached on its local address and the tailnet one may never be tried, and away from home
     * the local address fails while the tailnet one answers.
     */
    fun of(nodeRunning: Boolean, answers: Collection<Boolean>): RemoteNotice = when {
      !nodeRunning -> CONNECTING
      answers.any { it } -> CONNECTED
      answers.isEmpty() -> CONNECTING
      else -> UNREACHABLE
    }
  }
}

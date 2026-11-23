import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { flushSync } from 'react-dom';
import {
  decodeWorkspaceTransfer,
  encodeWorkspaceTransfer,
  type WorkspaceTab,
} from './workspaceTransfer';

type Options = {
  isBusy: boolean;
  getTabs: () => WorkspaceTab[];
  passwords: Map<string, string>;
  receive: (tabs: WorkspaceTab[]) => void;
  remove: (ids: string[]) => void;
  onError: (message: string) => void;
};

export function useWorkspaceTransfer(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const [isTransferring, setIsTransferring] = useState(false);
  const locked = useRef(false);
  const pollInFlight = useRef(false);
  const receiveRequested = useRef(true);
  const wake = useRef<() => void>(() => {});
  const outgoing = useRef<{ id: string; ids: string[] } | null>(null);
  const acknowledgement = useRef<{ id: string; accepted: boolean } | null>(null);

  useEffect(() => {
    let disposed = false;
    let ready = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    const poll = async () => {
      if (disposed) return;
      timer = undefined;
      if (pollInFlight.current) {
        timer = setTimeout(() => void poll(), 300);
        return;
      }
      pollInFlight.current = true;
      try {
        if (outgoing.current) {
          const status = await invoke<string>('workspace_tabs_status', { id: outgoing.current.id });
          if (status === 'accepted' || status === 'rejected') {
            if (status === 'accepted') latest.current.remove(outgoing.current.ids);
            else
              latest.current.onError('The tabs could not be moved. They are still in this window.');
            outgoing.current = null;
            locked.current = false;
            setIsTransferring(false);
          }
        } else if (
          receiveRequested.current &&
          !locked.current &&
          !latest.current.isBusy &&
          !acknowledgement.current
        ) {
          receiveRequested.current = false;
          locked.current = true;
          const transfer = await invoke<[string, string] | null>('receive_workspace_tabs');
          if (!transfer) locked.current = false;
          if (transfer) {
            locked.current = true;
            const [id, payload] = transfer;
            try {
              if (latest.current.isBusy) throw new Error('The destination is busy.');
              flushSync(() => window.dispatchEvent(new Event('paperdesk:flush-notes')));
              const received = decodeWorkspaceTransfer(payload);
              if (
                received.tabs.some((tab) =>
                  latest.current.getTabs().some((existing) => existing.id === tab.id),
                )
              ) {
                throw new Error('These tabs are already open in this window.');
              }
              flushSync(() => {
                received.passwords.forEach(([key, password]) =>
                  latest.current.passwords.set(key, password),
                );
                latest.current.receive(received.tabs);
                setIsTransferring(true);
              });
              acknowledgement.current = { id, accepted: true };
            } catch {
              acknowledgement.current = { id, accepted: false };
            }
          }
        }
        if (acknowledgement.current) {
          await invoke('finish_workspace_tabs', acknowledgement.current);
          acknowledgement.current = null;
          receiveRequested.current = true;
          locked.current = false;
          setIsTransferring(false);
        }
      } catch {
        // Retry IPC/acknowledgement failures without discarding the source's tabs.
        if (!outgoing.current && !acknowledgement.current) locked.current = false;
      } finally {
        pollInFlight.current = false;
        // Only unfinished handoffs need retries. An idle window has no repeating timer.
        if (
          !disposed &&
          (outgoing.current ||
            acknowledgement.current ||
            (receiveRequested.current && !latest.current.isBusy && !locked.current))
        ) {
          timer = setTimeout(() => void poll(), 300);
        }
      }
    };
    const requestReceive = () => {
      receiveRequested.current = true;
      wake.current();
    };
    wake.current = () => {
      if (disposed || !ready || pollInFlight.current) return;
      clearTimeout(timer);
      timer = setTimeout(() => void poll(), 0);
    };
    // Subscribe before checking the native queue: this also covers newly created windows.
    void listen('paperdesk://tabs-available', requestReceive)
      .then((stop) => {
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        ready = true;
        requestReceive();
      })
      .catch(() => {
        ready = true;
        if (!disposed) requestReceive();
      });
    window.addEventListener('focus', requestReceive);
    return () => {
      disposed = true;
      clearTimeout(timer);
      unlisten?.();
      window.removeEventListener('focus', requestReceive);
    };
  }, []);

  useEffect(() => {
    if (!options.isBusy && receiveRequested.current) wake.current();
  }, [options.isBusy]);

  const moveTabs = useCallback(
    async (ids: string[], newWindow = false, position?: { x: number; y: number }) => {
      if (locked.current || latest.current.isBusy) return;
      locked.current = true;
      flushSync(() => window.dispatchEvent(new Event('paperdesk:flush-notes')));
      setIsTransferring(true);
      try {
        const tabs = latest.current.getTabs().filter((tab) => ids.includes(tab.id));
        if (!tabs.length) return;
        const payload = encodeWorkspaceTransfer(tabs, latest.current.passwords);
        const id = await invoke<string | null>('move_workspace_tabs', {
          payload,
          newWindow,
          x: position?.x ?? null,
          y: position?.y ?? null,
        });
        if (id) outgoing.current = { id, ids: tabs.map((tab) => tab.id) };
      } catch {
        latest.current.onError('The tabs could not be moved. They are still in this window.');
      } finally {
        wake.current();
        if (!outgoing.current) {
          locked.current = false;
          setIsTransferring(false);
        }
      }
    },
    [],
  );

  return { moveTabs, isTransferring, transferLocked: locked };
}

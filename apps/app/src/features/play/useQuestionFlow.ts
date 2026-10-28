/**
 * Plays a run of questions one at a time with the serve → answer contract (doc 09 §2.5): the
 * taste test now, duel turns in step 1.4b. The correct answer only arrives with the reply to
 * the player's answer, and the timer starts when the question is on screen (TRD §5.3).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { AnswerRequest, AnswerResponse, ServedQuestion } from '@whosabi/shared-types';
import { PLATFORM } from '../../config';

export type FlowPhase = 'loading' | 'asking' | 'sending' | 'revealed' | 'error' | 'finished';

export interface PlayedQuestion {
  question: ServedQuestion;
  chosen: number | null;
  result: AnswerResponse;
}

export interface QuestionFlowOptions {
  total: number;
  serve: (seq: number) => Promise<ServedQuestion>;
  answer: (seq: number, body: AnswerRequest) => Promise<AnswerResponse>;
  /** Where to start, e.g. a duel turn resumed after the app was closed. */
  firstSeq?: number;
  /** False until the round exists, so nothing is served too early. */
  enabled?: boolean;
}

const TICK_MS = 100;

export function useQuestionFlow({ total, serve, answer, firstSeq = 1, enabled = true }: QuestionFlowOptions) {
  const [phase, setPhase] = useState<FlowPhase>('loading');
  const [seq, setSeq] = useState(firstSeq);
  const [question, setQuestion] = useState<ServedQuestion | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerResponse | null>(null);
  const [played, setPlayed] = useState<PlayedQuestion[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [remainingMs, setRemainingMs] = useState(0);

  const shownAt = useRef(0);
  const hiddenMs = useRef(0);
  const hiddenSince = useRef<number | null>(null);
  const pending = useRef<AnswerRequest | null>(null);
  const failedStep = useRef<'serve' | 'answer'>('serve');

  const load = useCallback(
    async (n: number) => {
      setPhase('loading');
      setChosen(null);
      setResult(null);
      pending.current = null;
      try {
        const q = await serve(n);
        setQuestion(q);
        setRemainingMs(q.time_limit_ms);
        shownAt.current = Date.now();
        hiddenMs.current = 0;
        hiddenSince.current = null;
        setPhase('asking');
      } catch (e) {
        failedStep.current = 'serve';
        setError(e);
        setPhase('error');
      }
    },
    [serve],
  );

  useEffect(() => {
    // Only the first question loads here; the rest come from next().
    if (enabled) void load(firstSeq);
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(
    async (body: AnswerRequest) => {
      if (!question) return;
      pending.current = body;
      setPhase('sending');
      try {
        const reply = await answer(question.seq, body);
        setResult(reply);
        setPlayed((list) => [
          ...list.filter((p) => p.question.seq !== question.seq),
          { question, chosen: body.display_index, result: reply },
        ]);
        setPhase('revealed');
      } catch (e) {
        failedStep.current = 'answer';
        setError(e);
        setPhase('error');
      }
    },
    [answer, question],
  );

  const elapsed = () => Math.max(0, Date.now() - shownAt.current);

  const tabHidden = () => {
    const open = hiddenSince.current === null ? 0 : Date.now() - hiddenSince.current;
    return Math.round(hiddenMs.current + open);
  };

  const submit = useCallback(
    (index: number | null) => {
      // pending: a second tap, or the timer firing just after a tap, before the screen updates.
      if (phase !== 'asking' || !question || pending.current) return;
      setChosen(index);
      const limit = question.time_limit_ms;
      void send({
        display_index: index,
        client_elapsed_ms: Math.min(elapsed(), limit),
        // FR-WEB-7: how long the tab was hidden during the question, as a signal only.
        ...(PLATFORM === 'web' ? { tab_hidden_ms: Math.min(tabHidden(), 600_000) } : {}),
      });
    },
    [phase, question, send],
  );

  // The countdown; at zero the question is sent unanswered.
  useEffect(() => {
    if (phase !== 'asking' || !question) return;
    const timer = setInterval(() => {
      const left = question.time_limit_ms - elapsed();
      setRemainingMs(Math.max(0, left));
      if (left <= 0) submit(null);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [phase, question, submit]);

  // Time with the tab or app hidden while a question is showing.
  useEffect(() => {
    if (phase !== 'asking') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (hiddenSince.current !== null) hiddenMs.current += Date.now() - hiddenSince.current;
        hiddenSince.current = null;
      } else if (hiddenSince.current === null) {
        hiddenSince.current = Date.now();
      }
    });
    return () => sub.remove();
  }, [phase]);

  const next = useCallback(() => {
    if (phase !== 'revealed') return;
    if (seq >= total) {
      setPhase('finished');
      return;
    }
    setSeq(seq + 1);
    void load(seq + 1);
  }, [phase, seq, total, load]);

  /** After an error: serve again, or re-send the same answer (the server keeps the first one). */
  const retry = useCallback(() => {
    if (phase !== 'error') return;
    if (failedStep.current === 'answer' && pending.current) void send(pending.current);
    else void load(seq);
  }, [phase, send, load, seq]);

  return { phase, seq, total, question, chosen, result, played, error, remainingMs, submit, next, retry };
}

export type QuestionFlow = ReturnType<typeof useQuestionFlow>;

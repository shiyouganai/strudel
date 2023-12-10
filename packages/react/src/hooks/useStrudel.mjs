import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { repl } from '@strudel.cycles/core';
import { transpiler } from '@strudel.cycles/transpiler';
import usePatternFrame from './usePatternFrame';
import usePostMessage from './usePostMessage.mjs';

function useStrudel({
  defaultOutput,
  interval,
  getTime,
  evalOnMount = false,
  initialCode = '',
  beforeEval,
  afterEval,
  editPattern,
  onEvalError,
  onToggle,
  canvasId,
  drawContext,
  drawTime = [-2, 2],
  paintOptions = {},
}) {
  const id = useMemo(() => s4(), []);
  canvasId = canvasId || `canvas-${id}`;
  // scheduler
  const [schedulerError, setSchedulerError] = useState();
  const [evalError, setEvalError] = useState();
  const [code, setCode] = useState(initialCode);
  const [activeCode, setActiveCode] = useState();
  const [pattern, setPattern] = useState();
  const [started, setStarted] = useState(false);
  const isDirty = code !== activeCode;
  //const shouldPaint = useCallback((pat) => !!(pat?.context?.onPaint && drawContext), [drawContext]);
  const shouldPaint = useCallback((pat) => !!pat?.context?.onPaint, []);

  // TODO: make sure this hook reruns when scheduler.started changes
  const { scheduler, evaluate, start, stop, pause, setCps } = useMemo(
    () =>
      repl({
        interval,
        defaultOutput,
        onSchedulerError: setSchedulerError,
        onEvalError: (err) => {
          setEvalError(err);
          onEvalError?.(err);
        },
        getTime,
        drawContext,
        transpiler,
        editPattern,
        beforeEval: async ({ code }) => {
          setCode(code);
          await beforeEval?.();
        },
        afterEval: (res) => {
          const { pattern: _pattern, code } = res;
          setActiveCode(code);
          setPattern(_pattern);
          setEvalError();
          setSchedulerError();
          afterEval?.(res);
        },
        onToggle: (v) => {
          setStarted(v);
          onToggle?.(v);
        },
      }),
    [defaultOutput, interval, getTime],
  );
  const broadcast = usePostMessage(({ data: { from, type } }) => {
    if (type === 'start' && from !== id) {
      // console.log('message', from, type);
      stop();
    }
  });
  const activateCode = useCallback(
    async (newCode, autostart = true) => {
      if (newCode) {
        setCode(code);
      }
      const res = await evaluate(newCode || code, autostart);
      broadcast({ type: 'start', from: id });
      return res;
    },
    [evaluate, code],
  );

  const onDraw = useCallback(
    (pattern, time, haps, drawTime) => {
      const { onPaint } = pattern.context || {};
      const ctx = typeof drawContext === 'function' ? drawContext(canvasId) : drawContext;
      onPaint?.(ctx, time, haps, drawTime, paintOptions);
    },
    [drawContext, canvasId, paintOptions],
  );

  const drawFirstFrame = useCallback(
    (pat) => {
      if (shouldPaint(pat)) {
        const [_, lookahead] = drawTime;
        const haps = pat.queryArc(0, lookahead);
        // draw at -0.001 to avoid activating haps at 0
        onDraw(pat, -0.001, haps, drawTime);
      }
    },
    [drawTime, onDraw, shouldPaint],
  );

  const inited = useRef();
  useEffect(() => {
    if (!inited.current && evalOnMount && code) {
      inited.current = true;
      evaluate(code, false).then((pat) => drawFirstFrame(pat));
    }
  }, [evalOnMount, code, evaluate, drawFirstFrame]);

  // this will stop the scheduler when hot reloading in development
  useEffect(() => {
    return () => {
      scheduler.stop();
    };
  }, [scheduler]);

  const togglePlay = async () => {
    if (started) {
      scheduler.stop();
      drawFirstFrame(pattern);
    } else {
      await activateCode();
    }
  };
  const error = schedulerError || evalError;

  usePatternFrame({
    pattern,
    started: shouldPaint(pattern) && started,
    getTime: () => scheduler.now(),
    drawTime,
    onDraw,
  });

  return {
    id,
    canvasId,
    code,
    setCode,
    error,
    schedulerError,
    scheduler,
    evalError,
    evaluate,
    activateCode,
    activeCode,
    isDirty,
    pattern,
    started,
    start,
    stop,
    pause,
    togglePlay,
    setCps,
  };
}

export default useStrudel;

function s4() {
  return Math.floor((1 + Math.random()) * 0x10000)
    .toString(16)
    .substring(1);
}

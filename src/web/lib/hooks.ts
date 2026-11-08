import { useEffect, useState } from 'react';

/** A value that follows its source after a quiet period, for search-as-you-type calls. */
export function useDebounced<Value>(value: Value, delayMs = 300): Value {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettled(value);
    }, delayMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, delayMs]);
  return settled;
}

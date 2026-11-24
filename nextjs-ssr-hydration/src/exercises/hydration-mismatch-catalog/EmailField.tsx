'use client';

import { useId } from 'react';

export function EmailField() {
  // useId derives the id from the component's position in the tree, which is the same on the server
  // and in the browser, so both renders produce the same value.
  const id = useId();
  return (
    <p>
      <label htmlFor={id}>Email</label> <input id={id} type="email" />
    </p>
  );
}

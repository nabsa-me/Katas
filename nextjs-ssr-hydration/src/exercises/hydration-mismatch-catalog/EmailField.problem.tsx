'use client';

export function EmailField() {
  // BUG: a different id on the server and in the browser, so the `for` and `id` attributes differ.
  // eslint-disable-next-line react-hooks/purity -- the flawed version: an impure value during render
  const id = `email-${Math.random().toString(36).slice(2)}`;
  return (
    <p>
      <label htmlFor={id}>Email</label> <input id={id} type="email" />
    </p>
  );
}

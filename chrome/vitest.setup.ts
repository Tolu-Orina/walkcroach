import '@testing-library/jest-dom/vitest';

/*
  jsdom implements no layout, so `scrollIntoView` is simply absent. `Stream`
  calls it to keep a running response pinned to the bottom; without this stub the
  component throws in tests for a reason that has nothing to do with the
  behaviour under test.
*/
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    /* no layout in jsdom */
  };
}

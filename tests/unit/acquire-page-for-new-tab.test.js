describe('acquirePageForNewTab', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  function makePage(url = 'about:blank', extra = {}) {
    return {
      url: jest.fn(() => url),
      isClosed: jest.fn(() => false),
      ...extra,
    };
  }

  test('reuses the single initial untracked about:blank page', async () => {
    const blank = makePage();
    const created = makePage();
    const context = {
      pages: jest.fn(() => [blank]),
      newPage: jest.fn(async () => created),
    };

    const { acquirePageForNewTab } = require('../../dist/src/services/tab');
    const page = await acquirePageForNewTab(context);

    expect(page).toBe(blank);
    expect(context.newPage).not.toHaveBeenCalled();
  });

  test('atomically reserves the initial blank page for concurrent tab creation', async () => {
    const blank = makePage();
    const created = makePage();
    const context = {
      pages: jest.fn(() => [blank]),
      newPage: jest.fn(async () => created),
    };

    const { acquirePageForNewTab } = require('../../dist/src/services/tab');
    const [firstPage, secondPage] = await Promise.all([
      acquirePageForNewTab(context),
      acquirePageForNewTab(context),
    ]);

    expect(firstPage).toBe(blank);
    expect(secondPage).toBe(created);
    expect(firstPage).not.toBe(secondPage);
    expect(context.newPage).toHaveBeenCalledTimes(1);
  });

  test('creates a new page when the only blank page is already tracked', async () => {
    const blank = makePage();
    blank.__camofox_tabId = 'existing-tab';
    const created = makePage();
    const context = {
      pages: jest.fn(() => [blank]),
      newPage: jest.fn(async () => created),
    };

    const { acquirePageForNewTab } = require('../../dist/src/services/tab');
    const page = await acquirePageForNewTab(context);

    expect(page).toBe(created);
    expect(context.newPage).toHaveBeenCalledTimes(1);
  });

  test('creates a new page when the context has no safe reusable blank page', async () => {
    const existing = makePage('https://example.com');
    const created = makePage();
    const context = {
      pages: jest.fn(() => [existing]),
      newPage: jest.fn(async () => created),
    };

    const { acquirePageForNewTab } = require('../../dist/src/services/tab');
    const page = await acquirePageForNewTab(context);

    expect(page).toBe(created);
    expect(context.newPage).toHaveBeenCalledTimes(1);
  });
});

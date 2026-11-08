import { act, render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StageBadge } from '../../src/web/components/StageBadge';
import { Dialog, ToastHost, useToast } from '../../src/web/components/overlays';
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Segmented,
  Skeleton,
} from '../../src/web/components/ui';
import { useDebounced } from '../../src/web/lib/hooks';
import { applyTheme } from '../../src/web/lib/theme';
import { ThemeToggle } from '../../src/web/components/ThemeToggle';

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('blocks clicks and announces work while busy', async () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Field', () => {
  it('connects label, hint and errors to the control', () => {
    render(
      <Field label="Email" hint="We only use it to send the link." errors={['Enter an email.']}>
        {(control) => <input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription('We only use it to send the link. Enter an email.');
  });

  it('adds no description when there is nothing to describe', () => {
    render(<Field label="Name">{(control) => <input {...control} />}</Field>);
    const input = screen.getByLabelText('Name');
    expect(input).toBeValid();
    expect(input).not.toHaveAttribute('aria-describedby');
  });
});

describe('Segmented', () => {
  it('marks the current option and reports a new choice', async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Filter"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'All' },
          { value: 'b', label: 'Open' },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Filter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('states', () => {
  it('announces loading politely with a text label', () => {
    render(<Skeleton lines={4} label="Loading requests" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading requests');
  });

  it('explains an empty list and offers the next step', () => {
    render(
      <EmptyState title="No requests yet" action={<Button>New request</Button>}>
        Send a template to get started.
      </EmptyState>,
    );
    expect(screen.getByRole('heading', { name: 'No requests yet' })).toBeInTheDocument();
    expect(screen.getByText('Send a template to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New request' })).toBeInTheDocument();
  });

  it('reports an error as an alert and retries on request', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="The server could not be reached." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The server could not be reached.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('has no retry button when retrying cannot help', () => {
    render(<ErrorState title="This link is not valid" message="Ask for a new one." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses the status role for calm banners and alert for urgent ones', () => {
    render(
      <>
        <Banner tone="success">Saved</Banner>
        <Banner tone="danger" role="alert">
          Failed
        </Banner>
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
  });
});

describe('StageBadge', () => {
  it('writes the stage out in words and says when it was fixed by hand', () => {
    render(
      <>
        <StageBadge stage="LAPSED" />
        <StageBadge stage="MEMBER" fixed />
      </>,
    );
    expect(screen.getByText('Lapsed')).toHaveClass('badge--warning');
    expect(screen.getByText('Member (fixed)')).toHaveClass('badge--success');
  });
});

describe('Dialog', () => {
  it('renders its content only while open, labelled by its title', () => {
    const { rerender } = render(
      <Dialog open={false} title="New template" onClose={vi.fn()}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.queryByText('Body')).not.toBeInTheDocument();

    rerender(
      <Dialog open title="New template" onClose={vi.fn()}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'New template' })).toHaveTextContent('Body');
  });

  it('tells the owner when the browser closes it (Escape or backdrop)', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Confirm" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    screen.getByRole('dialog').dispatchEvent(new Event('close'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('toasts', () => {
  function Announcer() {
    const toast = useToast();
    return (
      <button
        type="button"
        onClick={() => {
          toast('Saved');
        }}
      >
        Save
      </button>
    );
  }

  it('announce a short confirmation politely', async () => {
    render(
      <ToastHost>
        <Announcer />
      </ToastHost>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getAllByRole('status').some((region) => region.textContent === 'Saved')).toBe(
      true,
    );
  });
});

describe('hooks', () => {
  it('useDebounced follows its source after a quiet period', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, 300), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'ab' });
    rerender({ value: 'abc' });
    expect(result.current).toBe('a');
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('a');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('abc');
    vi.useRealTimers();
  });
});

describe('theme', () => {
  it('switches the document theme, remembers it and updates the toggle', async () => {
    applyTheme('light');
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem('record-merge-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });
});

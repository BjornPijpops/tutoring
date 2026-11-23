import { render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createTestServices } from '../test/render-with-services';
import { ConfigErrorScreen } from './config-error-screen';
import { ServicesProvider, useServices } from './services-context';

describe('useServices', () => {
  it('returns the provided services', () => {
    const services = createTestServices();
    const { result } = renderHook(() => useServices(), {
      wrapper: ({ children }) => (
        <ServicesProvider services={services}>{children}</ServicesProvider>
      ),
    });
    expect(result.current).toBe(services);
  });

  it('throws a clear error outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useServices())).toThrow(
      'useServices must be used within a ServicesProvider',
    );
    vi.restoreAllMocks();
  });
});

describe('ConfigErrorScreen', () => {
  it('shows the problem as an alert', () => {
    render(
      <ConfigErrorScreen
        error={{
          message: 'Invalid configuration: VITE_SUPABASE_URL',
          fields: ['VITE_SUPABASE_URL'],
        }}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Configuration problem' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('VITE_SUPABASE_URL');
  });
});

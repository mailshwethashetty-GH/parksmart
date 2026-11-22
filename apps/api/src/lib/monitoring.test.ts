import { describe, expect, it } from 'vitest';
import { reportError, scrubEvent } from './monitoring';

type Event = Parameters<typeof scrubEvent>[0];

describe('monitoring', () => {
  it('strips personal data from error events', () => {
    const event = scrubEvent({
      user: { id: 'u1', email: 'divya@example.com' },
      request: {
        url: 'https://parking.example.com/api/v1/me/vehicles',
        cookies: { 'parksmart.session_token': 'secret' },
        data: { plate: 'KA01AB1234' },
        query_string: 'email=divya@example.com',
        headers: { cookie: 'parksmart.session_token=secret', 'user-agent': 'Mozilla/5.0' },
      },
    } as unknown as Event);
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({
      url: 'https://parking.example.com/api/v1/me/vehicles',
      headers: { 'user-agent': 'Mozilla/5.0' },
    });
    expect(JSON.stringify(event)).not.toMatch(/KA01AB1234|secret|divya/);
  });

  it('does nothing when monitoring is off', () => {
    expect(() => reportError(new Error('boom'))).not.toThrow();
  });
});

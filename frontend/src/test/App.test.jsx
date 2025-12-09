import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import App from '../App'

// Mock fetch globally
global.fetch = vi.fn()

describe('App', () => {
  it('renders without crashing', () => {
    // Mock fetch to return empty data
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    })

    render(
      <BrowserRouter>
        <App />
      </BrowserRouter>
    )

    // Basic sanity check - app should render
    expect(document.body).toBeTruthy()
  })
})

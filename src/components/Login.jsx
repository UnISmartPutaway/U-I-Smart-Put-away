import { useState } from 'react'
import BrandMark from './BrandMark'
import { readAccountPasswordHashes, verifyAccountPassword } from '../data/accountSecurity'

function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setIsSubmitting(true)

    const demoAccounts = {
      admin: { name: 'Nhân viên kiểm hàng', role: 'ADMIN' },
      mover: { name: 'Nhân viên nâng chuyển', role: 'MOVER' },
      lifter: { name: 'Nhân viên nâng hạ', role: 'LIFTER' },
    }
    const account = demoAccounts[username.trim().toLowerCase()]

    try {
      const normalizedUsername = username.trim().toLowerCase()
      const passwordHashes = readAccountPasswordHashes()
      const savedHash = passwordHashes[normalizedUsername]
      const passwordMatches = savedHash
        ? await verifyAccountPassword(password, savedHash)
        : password === '123456'

      if (Object.hasOwn(demoAccounts, normalizedUsername) && passwordMatches) {
        setError('')
        onLogin({
          username: normalizedUsername,
          ...account,
        })
        return
      }

      setError('Tên đăng nhập hoặc mật khẩu không đúng.')
    } catch (loginError) {
      setError(loginError.message || 'Không thể xác thực tài khoản trên trình duyệt này.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="login-page">

      <div className="login-card">

        <div className="login-logo">
          <BrandMark />
        </div>

        <h1>U&amp;I Smart Put-away</h1>

        <p className="login-subtitle">
          Hệ thống điều phối cất hàng thông minh
        </p>

        <form onSubmit={handleSubmit}>

          <div className="login-field">
            <label htmlFor="login-username">Tên đăng nhập</label>

            <input
              id="login-username"
              type="text"
              placeholder="Nhập tên đăng nhập"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>

          <div className="login-field">
            <label htmlFor="login-password">Mật khẩu</label>

            <div className="password-box">

              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Nhập mật khẩu"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <button
                type="button"
                className="show-password"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? 'Ẩn' : 'Hiện'}
              </button>

            </div>
          </div>

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <div className="login-options">

            <label>
              <input type="checkbox" />
              Ghi nhớ đăng nhập
            </label>

            <button
              type="button"
              className="forgot-password"
            >
              Quên mật khẩu?
            </button>

          </div>

          <button
            type="submit"
            className="login-button"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Đang xác thực...' : 'Đăng nhập'}
          </button>

        </form>

        <div className="login-demo">
          <p>Tài khoản mô phỏng · mật khẩu ban đầu: <b>123456</b></p>

          <span>
            Admin / kiểm hàng: <b>admin</b>
          </span>

          <span>
            Nâng chuyển: <b>mover</b>
          </span>

          <span>
            Nâng hạ: <b>lifter</b>
          </span>
        </div>

      </div>

    </div>
  )
}

export default Login
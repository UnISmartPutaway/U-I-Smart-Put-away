import { useState } from 'react'

function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()

    if (username === 'admin' && password === '123456') {
      setError('')

      onLogin({
        username: 'admin',
        name: 'Administrator',
        role: 'ADMIN',
      })

      return
    }

    setError('Tên đăng nhập hoặc mật khẩu không đúng.')
  }

  return (
    <div className="login-page">

      <div className="login-card">

        <div className="login-logo">
          SL
        </div>

        <h1>SMART LOCATION</h1>

        <p className="login-subtitle">
          Warehouse Management System
        </p>

        <form onSubmit={handleSubmit}>

          <div className="login-field">
            <label>Tên đăng nhập</label>

            <input
              type="text"
              placeholder="Nhập tên đăng nhập"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>

          <div className="login-field">
            <label>Mật khẩu</label>

            <div className="password-box">

              <input
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
          >
            Đăng nhập
          </button>

        </form>

        <div className="login-demo">
          <p>Tài khoản thử nghiệm</p>

          <span>
            Username: <b>admin</b>
          </span>

          <span>
            Password: <b>123456</b>
          </span>
        </div>

      </div>

    </div>
  )
}

export default Login
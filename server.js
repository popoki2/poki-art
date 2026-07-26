<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>포키 파티!! - v1.8.0</title>

    <!-- 귀엽고 둥글둥글한 폰트 불러오기 (Gaegu & Jua 폰트) -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Gaegu:wght@400;700&family=Jua&display=swap" rel="stylesheet">

    <style>
        /* 기본 스타일 및 배경 설정 */
        body {
            background-color: #fcebf0; /* 연한 핑크톤 배경 */
            font-family: 'Gaegu', 'Jua', cursive, sans-serif; /* 둥글둥글 귀여운 폰트 적용 */
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
        }

        .container {
            text-align: center;
            width: 360px;
        }

        /* 메인 타이틀 (ポキパティ！！) */
        .main-title {
            font-family: 'Jua', sans-serif;
            font-size: 2.8rem;
            color: #ff5e8d;
            text-shadow: 2px 2px 0px #3c1e2e, -1px -1px 0 #3c1e2e, 1px -1px 0 #3c1e2e, -1px 1px 0 #3c1e2e;
            margin-bottom: 5px;
            letter-spacing: 2px;
        }

        /* 서브 타이틀 (포키의 놀이터) */
        .sub-title {
            font-family: 'Gaegu', cursive;
            font-size: 1.4rem;
            font-weight: bold;
            color: #5a3e4b;
            margin-top: 0;
            margin-bottom: 25px;
        }

        /* 입력 폼 스타일 */
        .input-group {
            margin-bottom: 12px;
        }

        .input-group input {
            width: 100%;
            padding: 10px 15px;
            font-size: 1.1rem;
            font-family: 'Gaegu', cursive; /* 입력창 내부 글씨도 귀엽게 */
            font-weight: bold;
            color: #4a333f;
            border: 3px solid #3c1e2e;
            border-radius: 12px;
            box-sizing: border-box;
            outline: none;
            background-color: #ffffff;
            transition: all 0.2s ease;
        }

        .input-group input::placeholder {
            color: #a08895;
        }

        .input-group input:focus {
            border-color: #ff5e8d;
            box-shadow: 0 0 8px rgba(255, 94, 141, 0.4);
        }

        /* 버튼 그룹 */
        .button-group {
            display: flex;
            justify-content: center;
            gap: 12px;
            margin-top: 20px;
        }

        .btn {
            padding: 8px 24px;
            font-family: 'Jua', sans-serif;
            font-size: 1.2rem;
            border: 3px solid #3c1e2e;
            border-radius: 12px;
            cursor: pointer;
            box-shadow: 0 4px 0 #3c1e2e;
            transition: transform 0.1s, box-shadow 0.1s;
        }

        .btn:active {
            transform: translateY(4px);
            box-shadow: 0 0 0 #3c1e2e;
        }

        .btn-login {
            background-color: #ff75a0;
            color: #ffffff;
        }

        .btn-signup {
            background-color: #ffb703;
            color: #ffffff;
        }

        /* 버전 패치노트 표시 */
        .version-info {
            margin-top: 25px;
            font-size: 0.9rem;
            color: #8c7380;
        }
    </style>
</head>
<body>

    <div class="container">
        <!-- 타이틀 영역 -->
        <h1 class="main-title">ポキパティ！！</h1>
        <p class="sub-title">~ 포키의 놀이터 ~</p>

        <!-- 로그인 / 회원가입 폼 -->
        <form onsubmit="return false;">
            <div class="input-group">
                <input type="text" placeholder="아이디" required>
            </div>
            <div class="input-group">
                <input type="password" placeholder="비밀번호" required>
            </div>
            <div class="input-group">
                <input type="text" placeholder="닉네임 (회원가입시)">
            </div>

            <!-- 버튼 영역 -->
            <div class="button-group">
                <button type="submit" class="btn btn-login">로그인</button>
                <button type="button" class="btn btn-signup">회원가입</button>
            </div>
        </form>

        <div class="version-info">Ver 1.8.0 Updated</div>
    </div>

</body>
</html>

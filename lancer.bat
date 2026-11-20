@echo off
setlocal EnableExtensions
chcp 65001 >nul
title CryptoLock - Control panel
cd /d "%~dp0"

set "ROOT=%~dp0"
set "RPC=http://127.0.0.1:8545"
set "WEB=http://localhost:3000"
set "INDEXER=http://127.0.0.1:4000/health"
set "WAIT=node "%ROOT%tools\wait-for.mjs""
set "EMPTY_READS=0"
set "AFTER_DEPLOY="

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo  [ERROR] Node.js was not found. Install Node.js 22.13 or later: https://nodejs.org
  echo.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)" >nul 2>&1
if not errorlevel 1 goto node_ok
for /f "delims=" %%V in ('node -v') do set "NODE_VERSION=%%V"
echo.
echo  [ERROR] Node.js %NODE_VERSION% is too old: install Node.js 22.13 or later from https://nodejs.org
echo.
pause
exit /b 1
:node_ok

if /i "%~1"=="polygon" (
  set "CHOICE=1"
  goto dispatch
)
if /i "%~1"=="local" (
  set "CHOICE=5"
  goto dispatch
)
if /i "%~1"=="github" (
  set "CHOICE=21"
  goto dispatch
)
if not "%~1"=="" (
  set "CHOICE=%~1"
  goto dispatch
)

:menu
cls
echo.
echo  ==================================================================
echo    CRYPTOLOCK  -  control panel
echo  ==================================================================
echo.
echo    POLYGON  -  MAIN NETWORK
echo      1. Launch the website on Polygon (production)
echo         deploys the contracts first if they are not on Polygon yet
echo      2. Free rehearsal of the Polygon deployment (local copy, nothing is sent)
echo      3. Deploy on Polygon Amoy   (main network testnet, free)
echo      4. Deploy on Polygon        (real coins)
echo.
echo    LOCAL DEVELOPMENT
echo      5. Start everything locally and open the website
echo         (blockchain + deployment + indexer + website)
echo      6. Open the website in the browser
echo      7. Stop everything
echo      8. Move the local blockchain time forward
echo      9. Simulate yield on the test vaults
echo.
echo    TESTS
echo     10. Run all tests (contracts, indexer, website types)
echo     11. End-to-end test of the interface (Chrome, fresh blockchain)
echo.
echo    OTHER NETWORKS
echo     12. List every network and its state
echo     13. Deploy on another network (number or key from the list)
echo     14. Deploy on every test network
echo     15. Deploy on every main network (real coins)
echo     16. Deploy on every network
echo     17. Free rehearsal on a local copy of another network
echo.
echo    MAINTENANCE
echo     18. Install / update the dependencies
echo     19. Export the ABIs to the website and the indexer
echo     20. Build the website for production (Polygon)
echo     21. Publish the project on GitHub
echo.
echo      0. Quit
echo.
set "CHOICE="
set /p "CHOICE=  Your choice: "
if defined CHOICE (set "EMPTY_READS=0") else (set /a EMPTY_READS+=1)
if %EMPTY_READS% GEQ 20 goto end

:dispatch
if "%CHOICE%"=="1" goto polygon_launch
if "%CHOICE%"=="2" goto rehearsal_polygon
if "%CHOICE%"=="3" goto deploy_amoy
if "%CHOICE%"=="4" goto deploy_polygon
if "%CHOICE%"=="5" goto start_all
if "%CHOICE%"=="6" goto open_site
if "%CHOICE%"=="7" goto stop_all
if "%CHOICE%"=="8" goto advance_time
if "%CHOICE%"=="9" goto simulate_yield
if "%CHOICE%"=="10" goto tests
if "%CHOICE%"=="11" goto e2e
if "%CHOICE%"=="12" goto networks
if "%CHOICE%"=="13" goto deploy_other
if "%CHOICE%"=="14" goto deploy_testnets
if "%CHOICE%"=="15" goto deploy_mainnets
if "%CHOICE%"=="16" goto deploy_everything
if "%CHOICE%"=="17" goto rehearsal
if "%CHOICE%"=="18" goto install
if "%CHOICE%"=="19" goto export_abis
if "%CHOICE%"=="20" goto build
if "%CHOICE%"=="21" goto github
if "%CHOICE%"=="0" goto end
goto menu


:polygon_launch
call :ensure_deps
if errorlevel 1 goto back_to_menu
echo.
echo  Checking the Polygon deployment...
node "%ROOT%tools\deployment-status.mjs" 137
if errorlevel 3 goto polygon_outdated
if errorlevel 1 goto polygon_missing
goto polygon_start

:polygon_outdated
echo  The contracts deployed on Polygon are an old version: they must be redeployed.
goto polygon_offer_deploy

:polygon_missing
echo  CryptoLock is not deployed on Polygon yet.

:polygon_offer_deploy
echo  Recommended first: option 2 (free rehearsal), then option 3 (trial on Polygon Amoy).
echo.
set "CONFIRM="
set /p "CONFIRM=  Deploy on Polygon now, then launch the website? (y/n): "
if /i not "%CONFIRM%"=="y" goto back_to_menu
set "AFTER_DEPLOY=polygon"
set "DEPLOY_TARGET=polygon"
goto deploy_flow

:polygon_start
echo.
echo  Stopping running services...
call :stop_services
call :check_ports
if errorlevel 1 goto back_to_menu
if not exist "%ROOT%web\.env.local" copy "%ROOT%web\.env.example" "%ROOT%web\.env.local" >nul
call :production_env
echo  [1/3] Building the website for Polygon: one to two minutes...
pushd "%ROOT%web"
call npm run build <nul
set "BUILD_RESULT=%errorlevel%"
popd
if not "%BUILD_RESULT%"=="0" goto polygon_build_failed
echo  [2/3] Starting the indexer...
call :launch "CryptoLock - Indexer" "%ROOT%indexer" "npm start"
%WAIT% "%INDEXER%" 60
if errorlevel 1 echo  [WARNING] The indexer does not answer: the website still works, without indexed history.
echo  [3/3] Starting the website...
call :launch "CryptoLock - Website" "%ROOT%web" "npm run start"
%WAIT% "%WEB%" 120
if errorlevel 1 goto polygon_site_failed
call :clear_launch_env
if not "%LOCK_NO_BROWSER%"=="1" start "" "%WEB%"
echo.
echo  ------------------------------------------------------------------
echo   CryptoLock is running on Polygon: %WEB%
echo.
echo   Connect your wallet: if it is on another network, the website
echo   asks it to switch to Polygon. The local network is not shown.
echo   Keep the "CryptoLock - Indexer" and "CryptoLock - Website"
echo   windows open. Option 7 stops everything.
echo.
echo   The contracts are not audited: only lock amounts you can afford
echo   to lose.
echo  ------------------------------------------------------------------
goto back_to_menu

:polygon_build_failed
call :clear_launch_env
echo  [ERROR] The website build failed: see the messages above.
goto back_to_menu

:polygon_site_failed
call :clear_launch_env
echo  [ERROR] The website does not answer: see the "CryptoLock - Website" window.
goto back_to_menu


:rehearsal_polygon
set "NET=polygon"
goto rehearsal_run

:rehearsal
set "NET="
set /p "NET=  Network to copy, number or key from option 12 (Enter = polygon): "
if not defined NET set "NET=polygon"
echo %NET%| findstr /r "^[A-Za-z0-9][A-Za-z0-9]*$" >nul
if errorlevel 1 (
  echo  Invalid network: enter a number or a key from the list of option 12.
  goto back_to_menu
)

:rehearsal_run
call :ensure_package contracts
if errorlevel 1 goto back_to_menu
echo.
echo  Local copy of %NET%: a complete deployment runs on it with the test accounts, against
echo  the real tokens and prices of the network. Nothing is sent to the real network and no
echo  deployment file is changed. The real deployment cost is shown at the end.
echo.
set "FORK_NETWORK=%NET%"
pushd "%ROOT%contracts"
call npx hardhat run scripts/deploy.ts <nul
set "REHEARSAL_RESULT=%errorlevel%"
popd
set "FORK_NETWORK="
echo.
if "%REHEARSAL_RESULT%"=="0" (
  echo  Rehearsal succeeded: the real deployment is option 3, 4 or 13.
) else (
  echo  The rehearsal failed: see the message above. If the public RPC refuses the copy,
  echo  set another one: set FORK_URL=https://... then run lancer.bat again.
)
goto back_to_menu


:start_all
call :start_services
if errorlevel 1 goto back_to_menu
if not "%LOCK_NO_BROWSER%"=="1" start "" "%WEB%"
echo.
echo  ------------------------------------------------------------------
echo   Everything is running.
echo     Website      %WEB%
echo     Blockchain   %RPC%   - chain id 31337
echo     Indexer      %INDEXER%
echo.
echo   Wallet: in MetaMask, add the "Hardhat" network
echo     RPC %RPC% - chain id 31337 - symbol ETH
echo   then import a development account: its private key is shown in the
echo   "CryptoLock - Blockchain" window. Accounts #1 to #4 hold test USDC,
echo   DAI, WBTC and NFTs. These keys are public: never on a real network.
echo.
echo   Keep the 3 "CryptoLock - ..." windows open. Option 7 stops everything.
echo  ------------------------------------------------------------------
goto back_to_menu


:open_site
%WAIT% "%WEB%" 2 >nul
if errorlevel 1 (
  echo.
  echo  The website is not running. Start option 1 for Polygon, or 5 locally.
  goto back_to_menu
)
start "" "%WEB%"
goto menu


:stop_all
echo.
echo  Stopping the local blockchain, the indexer and the website...
call :stop_services
echo  Done.
goto back_to_menu


:advance_time
call :require_node
if errorlevel 1 goto back_to_menu
set "DAYS="
set /p "DAYS=  Number of days to move forward, e.g. 30: "
if not defined DAYS goto menu
echo %DAYS%| findstr /r "^[0-9][0-9]*$ ^[0-9]*[.][0-9][0-9]*$" >nul
if errorlevel 1 (
  echo  Invalid value: enter a number of days, for example 30.
  goto back_to_menu
)
pushd "%ROOT%contracts"
call npm run dev:advance-time <nul
popd
goto back_to_menu


:simulate_yield
call :require_node
if errorlevel 1 goto back_to_menu
set "PERCENT="
set /p "PERCENT=  Yield to add, in percent, e.g. 1: "
if not defined PERCENT goto menu
echo %PERCENT%| findstr /r "^[0-9][0-9]*$ ^[0-9]*[.][0-9][0-9]*$" >nul
if errorlevel 1 (
  echo  Invalid value: enter a percentage, for example 1.
  goto back_to_menu
)
pushd "%ROOT%contracts"
call npm run dev:simulate-yield <nul
popd
goto back_to_menu


:tests
call :ensure_deps
if errorlevel 1 goto back_to_menu
set "FAILED="
echo.
echo  [1/3] Smart contracts
pushd "%ROOT%contracts"
call npm test <nul
if errorlevel 1 set "FAILED=%FAILED% contracts"
popd
echo.
echo  [2/3] Indexer
pushd "%ROOT%indexer"
call npm test <nul
if errorlevel 1 set "FAILED=%FAILED% indexer"
popd
echo.
echo  [3/3] Website type check
pushd "%ROOT%web"
call npm run typecheck <nul
if errorlevel 1 set "FAILED=%FAILED% website"
popd
echo.
if defined FAILED (
  echo  FAILED:%FAILED%
) else (
  echo  All tests passed.
)
goto back_to_menu


:e2e
call :ensure_deps
if errorlevel 1 goto back_to_menu
call :ensure_package e2e
if errorlevel 1 goto back_to_menu
echo.
echo  The test needs a fresh blockchain: restarting every service...
call :start_services
if errorlevel 1 goto back_to_menu
echo.
echo  Running the test in Chrome, in the background...
pushd "%ROOT%e2e"
call npm test <nul
if errorlevel 1 (
  echo.
  echo  End-to-end test FAILED. Screenshots: e2e\artifacts
) else (
  echo.
  echo  End-to-end test passed. Screenshots: e2e\artifacts
)
popd
echo  The services keep running: option 7 stops them.
goto back_to_menu


:networks
call :ensure_package contracts
if errorlevel 1 goto back_to_menu
pushd "%ROOT%contracts"
call npm run networks <nul
popd
goto back_to_menu


:deploy_amoy
set "DEPLOY_TARGET=polygonAmoy"
goto deploy_flow

:deploy_polygon
set "DEPLOY_TARGET=polygon"
goto deploy_flow

:deploy_testnets
set "DEPLOY_TARGET=testnets"
goto deploy_flow

:deploy_mainnets
set "DEPLOY_TARGET=mainnets"
goto deploy_flow

:deploy_everything
set "DEPLOY_TARGET=all"
goto deploy_flow

:deploy_other
call :ensure_package contracts
if errorlevel 1 goto back_to_menu
pushd "%ROOT%contracts"
call npm run networks <nul
popd
echo.
set "NET="
set /p "NET=  Network number or key, e.g. 5, arbitrum, baseSepolia: "
if not defined NET goto menu
echo %NET%| findstr /r "^[A-Za-z0-9][A-Za-z0-9]*$" >nul
if errorlevel 1 (
  echo  Invalid network: enter a number or a key from the list.
  goto back_to_menu
)
set "DEPLOY_TARGET=%NET%"
goto deploy_flow

:deploy_flow
set "RUN_RESULT="
call :ensure_package contracts
if errorlevel 1 goto deploy_done
if not exist "%ROOT%contracts\.env" goto deploy_no_env
echo.
echo  Checking the networks: deployment account balances and estimated costs...
set "DEPLOY_MODE=plan"
set "DEPLOY_MAINNETS_CONFIRMED="
pushd "%ROOT%contracts"
call npx hardhat run scripts/deploy-networks.ts <nul
set "PLAN_RESULT=%errorlevel%"
popd
if "%PLAN_RESULT%"=="3" goto deploy_nothing
if "%PLAN_RESULT%"=="4" goto deploy_confirm_mainnet
if not "%PLAN_RESULT%"=="0" goto deploy_failed
echo.
set "CONFIRM="
set /p "CONFIRM=  Deploy on these test networks? (y/n): "
if /i not "%CONFIRM%"=="y" goto deploy_done
goto deploy_run

:deploy_confirm_mainnet
echo.
echo  WARNING: MAIN NETWORK, REAL COINS.
echo  - Deployment fees are paid in real coins, with the key of contracts\.env.
echo  - The contracts are not audited: users would lock real funds in them.
echo    Have them audited before opening the service to the public.
echo  - Do the free rehearsal first, option 2, and a trial on Polygon Amoy, option 3.
echo.
set "CONFIRM="
set /p "CONFIRM=  Type YES in capital letters to confirm: "
if not "%CONFIRM%"=="YES" goto deploy_done
set "DEPLOY_MAINNETS_CONFIRMED=true"

:deploy_run
set "DEPLOY_MODE=run"
pushd "%ROOT%contracts"
call npx hardhat run scripts/deploy-networks.ts <nul
set "RUN_RESULT=%errorlevel%"
popd
echo.
if not "%RUN_RESULT%"=="0" (
  echo  At least one deployment failed: see the messages above.
  echo  Run the same option again: every interrupted deployment resumes where it stopped.
) else (
  echo  Deployment complete. Restart the website, option 1 for Polygon or 5 locally, to use it.
)
goto deploy_done

:deploy_no_env
echo.
echo  contracts\.env is missing.
echo  Copy contracts\.env.example to contracts\.env, then fill in at least:
echo    DEPLOYER_PRIVATE_KEY  - a dedicated deployment wallet, never your main wallet
echo    TREASURY_ADDRESS      - the address receiving the early-unlock fees
goto deploy_done

:deploy_nothing
echo.
echo  Nothing to deploy: see the Action column above.
goto deploy_done

:deploy_failed
echo.
echo  The network check failed: see the message above.

:deploy_done
set "DEPLOY_TARGET="
set "DEPLOY_MODE="
set "DEPLOY_MAINNETS_CONFIRMED="
if not "%AFTER_DEPLOY%"=="polygon" goto back_to_menu
set "AFTER_DEPLOY="
if not "%RUN_RESULT%"=="0" goto back_to_menu
node "%ROOT%tools\deployment-status.mjs" 137
if errorlevel 1 goto back_to_menu
goto polygon_start


:install
for %%D in (contracts indexer web e2e) do (
  echo.
  echo  == %%D ==
  pushd "%ROOT%%%D"
  call npm install --no-audit --no-fund <nul
  popd
)
echo.
echo  Dependencies installed.
goto back_to_menu


:export_abis
call :ensure_package contracts
if errorlevel 1 goto back_to_menu
pushd "%ROOT%contracts"
call npm run export-abis <nul
popd
goto back_to_menu


:build
call :ensure_package web
if errorlevel 1 goto back_to_menu
%WAIT% "%WEB%" 2 >nul
if not errorlevel 1 (
  echo.
  echo  The website is running: stop it first with option 7.
  goto back_to_menu
)
call :production_env
pushd "%ROOT%web"
call npm run build <nul
popd
call :clear_launch_env
goto back_to_menu


:github
where git >nul 2>&1
if errorlevel 1 goto github_no_git
pushd "%ROOT%"
if not exist "%ROOT%.git" git init -b main >nul
git config user.name >nul 2>&1
if errorlevel 1 goto github_identity
goto github_identity_ok

:github_identity
echo.
echo  Git needs a name and an email for the commits of this project.
set "GIT_NAME="
set "GIT_EMAIL="
set /p "GIT_NAME=  Your name or GitHub username: "
set /p "GIT_EMAIL=  Your GitHub email (or the noreply address from GitHub settings): "
if not defined GIT_NAME goto github_abort
if not defined GIT_EMAIL goto github_abort
git config user.name "%GIT_NAME%"
git config user.email "%GIT_EMAIL%"

:github_identity_ok
git remote get-url origin >nul 2>&1
if not errorlevel 1 goto github_remote_ok
echo.
echo  Create an EMPTY repository on https://github.com/new first - private is recommended -
echo  without README, .gitignore or license, then paste its address here.
set "REPO="
set /p "REPO=  Repository URL, e.g. https://github.com/you/cryptolock.git: "
if not defined REPO goto github_abort
echo %REPO%| findstr /r /i "^https://github\.com/[A-Za-z0-9_.-]*/[A-Za-z0-9_.-]*$ ^git@github\.com:[A-Za-z0-9_.-]*/[A-Za-z0-9_.-]*$" >nul
if errorlevel 1 (
  echo  Invalid address: expected https://github.com/USER/REPO.git
  goto github_abort
)
git remote add origin "%REPO%"

:github_remote_ok
git add -A
git diff --cached --name-only | findstr /r /i "\.env$ \.env\.local$ cle-api\.txt$ \.pem$ \.key$" >nul
if not errorlevel 1 goto github_secret
for /f "delims=" %%R in ('git remote get-url origin') do set "REPO=%%R"
echo.
git status --short | find /c /v "" > "%TEMP%\cryptolock-count.txt"
set /p FILE_COUNT=<"%TEMP%\cryptolock-count.txt"
del "%TEMP%\cryptolock-count.txt" >nul 2>&1
echo  %FILE_COUNT% file(s) changed. Secrets check passed: no .env file is included.
set "MSG="
set /p "MSG=  Commit message (Enter = Update CryptoLock): "
if not defined MSG set "MSG=Update CryptoLock"
set MSG=%MSG:"=%
set "CONFIRM="
set /p "CONFIRM=  Publish to %REPO%? (y/n): "
if /i not "%CONFIRM%"=="y" goto github_abort
git commit -m "%MSG%" >nul 2>&1
git branch -M main
git push -u origin main
if errorlevel 1 (
  echo.
  echo  [ERROR] The push failed: check the repository address and sign in to GitHub
  echo  in the window that opens, then run option 21 again.
  popd
  goto back_to_menu
)
popd
echo.
echo  Published on %REPO%
goto back_to_menu

:github_secret
git reset -q
echo.
echo  [STOPPED] A secret file - .env, private key or API key - would have been published.
echo  Nothing was sent. Check .gitignore, then run option 21 again.
popd
goto back_to_menu

:github_abort
echo.
echo  Publishing cancelled: nothing was sent.
popd
goto back_to_menu

:github_no_git
echo.
echo  Git is not installed. Install it with:
echo    winget install --id Git.Git -e
echo  or from https://git-scm.com/download/win, then reopen lancer.bat.
goto back_to_menu


:production_env
set "NEXT_PUBLIC_APP_MODE=production"
set "NEXT_PUBLIC_DEFAULT_CHAIN_ID=137"
set "INDEXER_SKIP_LOCAL=true"
exit /b 0

:clear_launch_env
set "NEXT_PUBLIC_APP_MODE="
set "NEXT_PUBLIC_DEFAULT_CHAIN_ID="
set "INDEXER_SKIP_LOCAL="
exit /b 0

:start_services
call :ensure_deps
if errorlevel 1 exit /b 1
echo.
echo  Stopping running services...
call :stop_services
call :check_ports
if errorlevel 1 exit /b 1
if not exist "%ROOT%web\.env.local" copy "%ROOT%web\.env.example" "%ROOT%web\.env.local" >nul
call :clear_launch_env
set "NEXT_PUBLIC_DEFAULT_CHAIN_ID=31337"

echo  [1/4] Starting the local blockchain...
call :launch "CryptoLock - Blockchain" "%ROOT%contracts" "npm run node"
%WAIT% "%RPC%" 90 --rpc
if errorlevel 1 (
  set "NEXT_PUBLIC_DEFAULT_CHAIN_ID="
  echo  [ERROR] The local blockchain does not answer: see the "CryptoLock - Blockchain" window.
  exit /b 1
)

echo  [2/4] Deploying the contracts and the test assets...
pushd "%ROOT%contracts"
call npm run deploy:local <nul
if errorlevel 1 (
  popd
  set "NEXT_PUBLIC_DEFAULT_CHAIN_ID="
  echo  [ERROR] The local deployment failed.
  exit /b 1
)
call npm run export-abis <nul >nul
popd

echo  [3/4] Starting the indexer...
call :launch "CryptoLock - Indexer" "%ROOT%indexer" "npm start"
%WAIT% "%INDEXER%" 60
if errorlevel 1 echo  [WARNING] The indexer does not answer: the website still works, without indexed history.

echo  [4/4] Starting the website: the first build can take a minute...
call :launch "CryptoLock - Website" "%ROOT%web" "npm run dev"
set "NEXT_PUBLIC_DEFAULT_CHAIN_ID="
%WAIT% "%WEB%" 240
if errorlevel 1 (
  echo  [ERROR] The website does not answer: see the "CryptoLock - Website" window.
  exit /b 1
)
exit /b 0


:launch
if "%LOCK_MINIMIZED%"=="1" (
  start "%~1" /MIN /D "%~2" cmd /k %~3
) else (
  start "%~1" /D "%~2" cmd /k %~3
)
exit /b 0


:stop_services
taskkill /FI "WINDOWTITLE eq CryptoLock - Blockchain*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq CryptoLock - Indexer*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq CryptoLock - Website*" /T /F >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$root = $env:ROOT.TrimEnd('\').ToLower(); foreach ($port in 8545, 4000, 3000) { Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $proc = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess) -ErrorAction SilentlyContinue; if ($proc -and $proc.Name -eq 'node.exe' -and $proc.CommandLine -and $proc.CommandLine.ToLower().Contains($root)) { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue } } }" <nul
exit /b 0


:check_ports
powershell -NoProfile -ExecutionPolicy Bypass -Command "for ($i = 0; $i -lt 10; $i++) { $busy = @(8545, 4000, 3000 | Where-Object { Get-NetTCPConnection -LocalPort $_ -State Listen -ErrorAction SilentlyContinue }); if ($busy.Count -eq 0) { exit 0 }; Start-Sleep -Milliseconds 500 }; Write-Host ('  Ports: ' + ($busy -join ', ')); exit 1" <nul
if errorlevel 1 (
  echo  [ERROR] Another program uses a required port: 8545 blockchain, 4000 indexer or 3000 website.
  echo  Close that program, then try again.
  exit /b 1
)
exit /b 0


:require_node
%WAIT% "%RPC%" 2 --rpc >nul
if errorlevel 1 (
  echo.
  echo  The local blockchain is not running. Start option 5 first.
  exit /b 1
)
exit /b 0


:ensure_deps
call :ensure_package contracts
if errorlevel 1 exit /b 1
call :ensure_package indexer
if errorlevel 1 exit /b 1
call :ensure_package web
if errorlevel 1 exit /b 1
exit /b 0


:ensure_package
if exist "%ROOT%%~1\node_modules" exit /b 0
echo  Installing the dependencies of %~1 - once, a few minutes...
pushd "%ROOT%%~1"
call npm install --no-audit --no-fund <nul
if errorlevel 1 (
  popd
  echo  [ERROR] Installing the dependencies of %~1 failed.
  exit /b 1
)
popd
exit /b 0


:back_to_menu
echo.
pause
goto menu


:end
endlocal
exit /b 0

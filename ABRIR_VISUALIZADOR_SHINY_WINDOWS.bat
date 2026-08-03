@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title SisMOM Meta 1 - Visualizador R Shiny

set "RSCRIPT="
set "R_HOME_FOUND="

rem 1) Tenta localizar pelo PATH.
for /f "delims=" %%I in ('where Rscript.exe 2^>nul') do if not defined RSCRIPT set "RSCRIPT=%%I"

rem 2) Tenta localizar pelo Registro do Windows.
if not defined RSCRIPT (
  for %%K in (
    "HKLM\SOFTWARE\R-core\R"
    "HKCU\SOFTWARE\R-core\R"
    "HKLM\SOFTWARE\WOW6432Node\R-core\R"
  ) do (
    for /f "tokens=2,*" %%A in ('reg query %%K /v InstallPath 2^>nul ^| findstr /I "InstallPath"') do if not defined R_HOME_FOUND set "R_HOME_FOUND=%%B"
  )
)

if not defined RSCRIPT if defined R_HOME_FOUND if exist "%R_HOME_FOUND%\bin\Rscript.exe" set "RSCRIPT=%R_HOME_FOUND%\bin\Rscript.exe"
if not defined RSCRIPT if defined R_HOME_FOUND if exist "%R_HOME_FOUND%\bin\x64\Rscript.exe" set "RSCRIPT=%R_HOME_FOUND%\bin\x64\Rscript.exe"

rem 3) Procura instalacoes padrao em Arquivos de Programas.
if not defined RSCRIPT (
  for /f "delims=" %%D in ('dir /b /ad /o-n "%ProgramFiles%\R\R-*" 2^>nul') do if not defined RSCRIPT (
    if exist "%ProgramFiles%\R\%%D\bin\Rscript.exe" set "RSCRIPT=%ProgramFiles%\R\%%D\bin\Rscript.exe"
    if not defined RSCRIPT if exist "%ProgramFiles%\R\%%D\bin\x64\Rscript.exe" set "RSCRIPT=%ProgramFiles%\R\%%D\bin\x64\Rscript.exe"
  )
)

if not defined RSCRIPT if defined ProgramFiles(x86) (
  for /f "delims=" %%D in ('dir /b /ad /o-n "%ProgramFiles(x86)%\R\R-*" 2^>nul') do if not defined RSCRIPT (
    if exist "%ProgramFiles(x86)%\R\%%D\bin\Rscript.exe" set "RSCRIPT=%ProgramFiles(x86)%\R\%%D\bin\Rscript.exe"
    if not defined RSCRIPT if exist "%ProgramFiles(x86)%\R\%%D\bin\x64\Rscript.exe" set "RSCRIPT=%ProgramFiles(x86)%\R\%%D\bin\x64\Rscript.exe"
  )
)

if not defined RSCRIPT (
  echo.
  echo ERRO: O R foi instalado, mas o arquivo Rscript.exe nao foi localizado.
  echo.
  echo Caminho normalmente esperado:
  echo C:\Program Files\R\R-4.6.1\bin\Rscript.exe
  echo.
  echo Reinstale o R no caminho padrao ou adicione a pasta bin do R ao PATH.
  echo O RStudio nao e necessario para abrir este visualizador.
  echo.
  pause
  exit /b 1
)

echo R encontrado em:
echo "%RSCRIPT%"
echo.
echo Verificando e instalando os pacotes necessarios...
"%RSCRIPT%" install_packages.R
if errorlevel 1 (
  echo.
  echo ERRO: Nao foi possivel instalar ou verificar os pacotes R.
  echo Verifique sua conexao com a internet e tente novamente.
  echo.
  pause
  exit /b 1
)

echo.
echo Iniciando o visualizador SisMOM...
echo O navegador deve abrir automaticamente em http://127.0.0.1:3838
"%RSCRIPT%" run_local.R

if errorlevel 1 (
  echo.
  echo O visualizador foi encerrado com erro. Leia a mensagem acima.
)
pause

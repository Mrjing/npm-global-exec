#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// 用户目录下的固定安装路径
const INSTALL_DIR = path.join(os.homedir(), 'cloudbase-mcp');

function main() {
	const packageName = process.argv[2];

	if (!packageName) {
		console.error('Usage: npm-global-exec <package-name> [args...]');
		process.exit(1);
	}

	const additionalArgs = process.argv.slice(3);

	// 确保安装目录存在
	ensureInstallDirectory();

	console.log(`Installing ${packageName} in user directory...`);

	// 在用户目录下安装包
	installPackageLocally(packageName, additionalArgs);
}

function ensureInstallDirectory() {
	if (!fs.existsSync(INSTALL_DIR)) {
		console.log(`Creating install directory: ${INSTALL_DIR}`);
		fs.mkdirSync(INSTALL_DIR, { recursive: true });
	}

	// 初始化package.json（如果不存在）
	const packageJsonPath = path.join(INSTALL_DIR, 'package.json');
	if (!fs.existsSync(packageJsonPath)) {
		const packageJson = {
			name: 'cloudbase-mcp-packages',
			version: '1.0.0',
			description: 'User directory for npm-global-exec packages',
			private: true,
			dependencies: {}
		};
		fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
		console.log('Initialized package.json in install directory');
	}
}

function installPackageLocally(packageName, additionalArgs) {
	// Windows环境下需要特殊处理npm命令
	const isWindows = process.platform === 'win32';
	const npmCommand = isWindows ? 'npm.cmd' : 'npm';
	
	console.log(`Using npm command: ${npmCommand}`);
	
	const npmInstall = spawn(npmCommand, ['install', packageName, '--registry', 'https://mirrors.cloud.tencent.com/npm/'], {
		cwd: INSTALL_DIR,
		stdio: 'inherit',
		shell: isWindows, // Windows下使用shell执行
	});

	npmInstall.on('close', (code) => {
		if (code !== 0) {
			console.error(`Failed to install ${packageName} (exit code: ${code})`);
			process.exit(1);
		}

		console.log(`Successfully installed ${packageName}`);

		// 查找并执行包的bin文件
		executePackageBin(packageName, additionalArgs);
	});

	npmInstall.on('error', (err) => {
		if (err.code === 'ENOENT') {
			console.error('\nError: npm command not found!');
			console.error('Please make sure Node.js and npm are properly installed.');
			console.error('You can download Node.js from: https://nodejs.org/');
			console.error('\nTroubleshooting steps:');
			console.error('1. Verify npm is installed: npm --version');
			console.error('2. Check if npm is in PATH environment variable');
			console.error('3. Restart terminal after installing Node.js');
		} else {
			console.error(`Error installing ${packageName}:`, err);
		}
		process.exit(1);
	});
}

function executePackageBin(packageName, args) {
	// 从包名中提取实际的包名（去掉版本号）
	let actualPackageName;
	if (packageName.startsWith('@')) {
		// 处理scoped包名，如 @cloudbase/cloudbase-mcp@latest
		const lastAtIndex = packageName.lastIndexOf('@');
		if (lastAtIndex > 0) {
			// 有版本号的情况，取最后一个@之前的部分
			actualPackageName = packageName.substring(0, lastAtIndex);
		} else {
			// 没有版本号的情况
			actualPackageName = packageName;
		}
	} else {
		// 处理普通包名，如 cowsay@1.6.0
		actualPackageName = packageName.split('@')[0];
	}

	// 查找包的package.json
	const packageJsonPath = path.join(
		INSTALL_DIR,
		'node_modules',
		actualPackageName,
		'package.json'
	);

	if (!fs.existsSync(packageJsonPath)) {
		console.error(`Package ${actualPackageName} not found at ${packageJsonPath}`);
		process.exit(1);
	}

	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

	// 获取bin字段
	let binPath;
	if (typeof packageJson.bin === 'string') {
		binPath = packageJson.bin;
	} else if (packageJson.bin && typeof packageJson.bin === 'object') {
		// 如果bin是对象，使用包名作为key，或使用第一个
		binPath =
			packageJson.bin[actualPackageName] || Object.values(packageJson.bin)[0];
	} else {
		console.error(`No bin field found in ${actualPackageName}`);
		process.exit(1);
	}

	// 构建完整的bin文件路径
	const fullBinPath = path.join(
		INSTALL_DIR,
		'node_modules',
		actualPackageName,
		binPath
	);

	if (!fs.existsSync(fullBinPath)) {
		console.error(`Bin file not found: ${fullBinPath}`);
		process.exit(1);
	}

	console.log(`Executing ${actualPackageName}...`);

	// 执行bin文件
	const childProcess = spawn('node', [fullBinPath, ...args], {
		stdio: 'inherit',
	});

	childProcess.on('close', (code) => {
		process.exit(code);
	});

	childProcess.on('error', (err) => {
		console.error(`Error executing ${actualPackageName}:`, err);
		process.exit(1);
	});
}

main();

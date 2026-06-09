import {
	CapacitorBarcodeScanner,
	CapacitorBarcodeScannerCameraDirection,
	CapacitorBarcodeScannerScanOrientation,
	CapacitorBarcodeScannerTypeHint,
} from "@capacitor/barcode-scanner";

export function useBarcodeScanner() {
	const isScanning = useState("barcode-scanner-scanning", () => false);
	const lastScanResult = useState<string | null>(
		"barcode-scanner-last-result",
		() => null,
	);
	const scanError = useState<string | null>(
		"barcode-scanner-error",
		() => null,
	);

	const scanEan = async (scanInstructions: string) => {
		isScanning.value = true;
		scanError.value = null;

		try {
			const result = await CapacitorBarcodeScanner.scanBarcode({
				hint: CapacitorBarcodeScannerTypeHint.ALL,
				cameraDirection: CapacitorBarcodeScannerCameraDirection.BACK,
				scanOrientation: CapacitorBarcodeScannerScanOrientation.ADAPTIVE,
				scanInstructions,
				scanButton: false,
				web: {
					showCameraSelection: true,
					scannerFPS: 10,
				},
			});

			const scannedValue = result.ScanResult.trim();
			lastScanResult.value = scannedValue || null;
			return lastScanResult.value;
		} catch (error) {
			scanError.value = error instanceof Error ? error.message : String(error);
			return null;
		} finally {
			isScanning.value = false;
		}
	};

	return {
		isScanning,
		lastScanResult,
		scanError,
		scanEan,
	};
}

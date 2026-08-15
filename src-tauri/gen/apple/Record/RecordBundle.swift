//
//  RecordBundle.swift
//  Record
//
//  Created by Daniele Rolli on 8/15/26.
//

import WidgetKit
import SwiftUI

@main
struct RecordBundle: WidgetBundle {
    var body: some Widget {
        Record()
        RecordControl()
        RecordLiveActivity()
    }
}
